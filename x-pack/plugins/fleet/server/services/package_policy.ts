/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { omit } from 'lodash';
import { i18n } from '@kbn/i18n';
import type { KibanaRequest } from 'src/core/server';
import type {
  ElasticsearchClient,
  RequestHandlerContext,
  SavedObjectsClientContract,
} from 'src/core/server';
import uuid from 'uuid';

import type { AuthenticatedUser } from '../../../security/server';
import {
  packageToPackagePolicy,
  packageToPackagePolicyInputs,
  isPackageLimited,
  doesAgentPolicyAlreadyIncludePackage,
} from '../../common';
import type {
  DeletePackagePoliciesResponse,
  UpgradePackagePolicyResponse,
  PackagePolicyInput,
  NewPackagePolicyInput,
  PackagePolicyConfigRecordEntry,
  PackagePolicyInputStream,
  PackageInfo,
  ListWithKuery,
  ListResult,
  UpgradePackagePolicyDryRunResponseItem,
} from '../../common';
import { PACKAGE_POLICY_SAVED_OBJECT_TYPE } from '../constants';
import {
  HostedAgentPolicyRestrictionRelatedError,
  IngestManagerError,
  ingestErrorToResponseOptions,
} from '../errors';
import { NewPackagePolicySchema, UpdatePackagePolicySchema } from '../types';
import type {
  NewPackagePolicy,
  UpdatePackagePolicy,
  PackagePolicy,
  PackagePolicySOAttributes,
  RegistryPackage,
  DryRunPackagePolicy,
} from '../types';
import type { ExternalCallback } from '..';

import { agentPolicyService } from './agent_policy';
import { outputService } from './output';
import * as Registry from './epm/registry';
import { getPackageInfo, getInstallation, ensureInstalledPackage } from './epm/packages';
import { getAssetsData } from './epm/packages/assets';
import { compileTemplate } from './epm/agent/agent';
import { normalizeKuery } from './saved_object';
import { appContextService } from '.';

export type InputsOverride = Partial<NewPackagePolicyInput> & {
  vars?: Array<NewPackagePolicyInput['vars'] & { name: string }>;
};

const SAVED_OBJECT_TYPE = PACKAGE_POLICY_SAVED_OBJECT_TYPE;

class PackagePolicyService {
  public async create(
    soClient: SavedObjectsClientContract,
    esClient: ElasticsearchClient,
    packagePolicy: NewPackagePolicy,
    options?: {
      id?: string;
      user?: AuthenticatedUser;
      bumpRevision?: boolean;
      force?: boolean;
      skipEnsureInstalled?: boolean;
    }
  ): Promise<PackagePolicy> {
    // Check that its agent policy does not have a package policy with the same name
    const parentAgentPolicy = await agentPolicyService.get(soClient, packagePolicy.policy_id);
    if (!parentAgentPolicy) {
      throw new Error('Agent policy not found');
    }
    if (parentAgentPolicy.is_managed && !options?.force) {
      throw new HostedAgentPolicyRestrictionRelatedError(
        `Cannot add integrations to hosted agent policy ${parentAgentPolicy.id}`
      );
    }
    if (
      (parentAgentPolicy.package_policies as PackagePolicy[]).find(
        (siblingPackagePolicy) => siblingPackagePolicy.name === packagePolicy.name
      )
    ) {
      throw new IngestManagerError(
        'There is already a package with the same name on this agent policy'
      );
    }

    // Add ids to stream
    const packagePolicyId = options?.id || uuid.v4();
    let inputs: PackagePolicyInput[] = packagePolicy.inputs.map((input) =>
      assignStreamIdToInput(packagePolicyId, input)
    );

    // Make sure the associated package is installed
    if (packagePolicy.package?.name) {
      const pkgInfoPromise = getPackageInfo({
        savedObjectsClient: soClient,
        pkgName: packagePolicy.package.name,
        pkgVersion: packagePolicy.package.version,
      });

      let pkgInfo;
      if (options?.skipEnsureInstalled) pkgInfo = await pkgInfoPromise;
      else {
        const [, packageInfo] = await Promise.all([
          ensureInstalledPackage({
            esClient,
            savedObjectsClient: soClient,
            pkgName: packagePolicy.package.name,
            pkgVersion: packagePolicy.package.version,
          }),
          pkgInfoPromise,
        ]);
        pkgInfo = packageInfo;
      }

      // Check if it is a limited package, and if so, check that the corresponding agent policy does not
      // already contain a package policy for this package
      if (isPackageLimited(pkgInfo)) {
        const agentPolicy = await agentPolicyService.get(soClient, packagePolicy.policy_id, true);
        if (agentPolicy && doesAgentPolicyAlreadyIncludePackage(agentPolicy, pkgInfo.name)) {
          throw new IngestManagerError(
            `Unable to create package policy. Package '${pkgInfo.name}' already exists on this agent policy.`
          );
        }
      }

      inputs = await this.compilePackagePolicyInputs(pkgInfo, packagePolicy.vars || {}, inputs);
    }

    const isoDate = new Date().toISOString();
    const newSo = await soClient.create<PackagePolicySOAttributes>(
      SAVED_OBJECT_TYPE,
      {
        ...packagePolicy,
        inputs,
        revision: 1,
        created_at: isoDate,
        created_by: options?.user?.username ?? 'system',
        updated_at: isoDate,
        updated_by: options?.user?.username ?? 'system',
      },

      { ...options, id: packagePolicyId }
    );

    // Assign it to the given agent policy
    await agentPolicyService.assignPackagePolicies(
      soClient,
      esClient,
      packagePolicy.policy_id,
      [newSo.id],
      {
        user: options?.user,
        bumpRevision: options?.bumpRevision ?? true,
        force: options?.force,
      }
    );

    return {
      id: newSo.id,
      version: newSo.version,
      ...newSo.attributes,
    };
  }

  public async bulkCreate(
    soClient: SavedObjectsClientContract,
    esClient: ElasticsearchClient,
    packagePolicies: NewPackagePolicy[],
    agentPolicyId: string,
    options?: { user?: AuthenticatedUser; bumpRevision?: boolean }
  ): Promise<PackagePolicy[]> {
    const isoDate = new Date().toISOString();
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { saved_objects } = await soClient.bulkCreate<PackagePolicySOAttributes>(
      packagePolicies.map((packagePolicy) => {
        const packagePolicyId = uuid.v4();

        const inputs = packagePolicy.inputs.map((input) =>
          assignStreamIdToInput(packagePolicyId, input)
        );

        return {
          type: SAVED_OBJECT_TYPE,
          id: packagePolicyId,
          attributes: {
            ...packagePolicy,
            inputs,
            policy_id: agentPolicyId,
            revision: 1,
            created_at: isoDate,
            created_by: options?.user?.username ?? 'system',
            updated_at: isoDate,
            updated_by: options?.user?.username ?? 'system',
          },
        };
      })
    );

    // Filter out invalid SOs
    const newSos = saved_objects.filter((so) => !so.error && so.attributes);

    // Assign it to the given agent policy
    await agentPolicyService.assignPackagePolicies(
      soClient,
      esClient,
      agentPolicyId,
      newSos.map((newSo) => newSo.id),
      {
        user: options?.user,
        bumpRevision: options?.bumpRevision ?? true,
      }
    );

    return newSos.map((newSo) => ({
      id: newSo.id,
      version: newSo.version,
      ...newSo.attributes,
    }));
  }

  public async get(
    soClient: SavedObjectsClientContract,
    id: string
  ): Promise<PackagePolicy | null> {
    const packagePolicySO = await soClient.get<PackagePolicySOAttributes>(SAVED_OBJECT_TYPE, id);
    if (!packagePolicySO) {
      return null;
    }

    if (packagePolicySO.error) {
      throw new Error(packagePolicySO.error.message);
    }

    return {
      id: packagePolicySO.id,
      version: packagePolicySO.version,
      ...packagePolicySO.attributes,
    };
  }

  public async getByIDs(
    soClient: SavedObjectsClientContract,
    ids: string[]
  ): Promise<PackagePolicy[] | null> {
    const packagePolicySO = await soClient.bulkGet<PackagePolicySOAttributes>(
      ids.map((id) => ({
        id,
        type: SAVED_OBJECT_TYPE,
      }))
    );
    if (!packagePolicySO) {
      return null;
    }

    return packagePolicySO.saved_objects.map((so) => ({
      id: so.id,
      version: so.version,
      ...so.attributes,
    }));
  }

  public async list(
    soClient: SavedObjectsClientContract,
    options: ListWithKuery
  ): Promise<ListResult<PackagePolicy>> {
    const { page = 1, perPage = 20, sortField = 'updated_at', sortOrder = 'desc', kuery } = options;

    const packagePolicies = await soClient.find<PackagePolicySOAttributes>({
      type: SAVED_OBJECT_TYPE,
      sortField,
      sortOrder,
      page,
      perPage,
      filter: kuery ? normalizeKuery(SAVED_OBJECT_TYPE, kuery) : undefined,
    });

    return {
      items: packagePolicies.saved_objects.map((packagePolicySO) => ({
        id: packagePolicySO.id,
        version: packagePolicySO.version,
        ...packagePolicySO.attributes,
      })),
      total: packagePolicies.total,
      page,
      perPage,
    };
  }

  public async listIds(
    soClient: SavedObjectsClientContract,
    options: ListWithKuery
  ): Promise<ListResult<string>> {
    const { page = 1, perPage = 20, sortField = 'updated_at', sortOrder = 'desc', kuery } = options;

    const packagePolicies = await soClient.find<{}>({
      type: SAVED_OBJECT_TYPE,
      sortField,
      sortOrder,
      page,
      perPage,
      fields: [],
      filter: kuery ? normalizeKuery(SAVED_OBJECT_TYPE, kuery) : undefined,
    });

    return {
      items: packagePolicies.saved_objects.map((packagePolicySO) => packagePolicySO.id),
      total: packagePolicies.total,
      page,
      perPage,
    };
  }

  public async update(
    soClient: SavedObjectsClientContract,
    esClient: ElasticsearchClient,
    id: string,
    packagePolicy: UpdatePackagePolicy,
    options?: { user?: AuthenticatedUser }
  ): Promise<PackagePolicy> {
    const oldPackagePolicy = await this.get(soClient, id);
    const { version, ...restOfPackagePolicy } = packagePolicy;

    if (!oldPackagePolicy) {
      throw new Error('Package policy not found');
    }

    // Check that its agent policy does not have a package policy with the same name
    const parentAgentPolicy = await agentPolicyService.get(soClient, packagePolicy.policy_id);
    if (!parentAgentPolicy) {
      throw new Error('Agent policy not found');
    }
    if (
      (parentAgentPolicy.package_policies as PackagePolicy[]).find(
        (siblingPackagePolicy) =>
          siblingPackagePolicy.id !== id && siblingPackagePolicy.name === packagePolicy.name
      )
    ) {
      throw new Error('There is already a package with the same name on this agent policy');
    }

    let inputs = restOfPackagePolicy.inputs.map((input) =>
      assignStreamIdToInput(oldPackagePolicy.id, input)
    );

    inputs = enforceFrozenInputs(oldPackagePolicy.inputs, inputs);

    if (packagePolicy.package?.name) {
      const pkgInfo = await getPackageInfo({
        savedObjectsClient: soClient,
        pkgName: packagePolicy.package.name,
        pkgVersion: packagePolicy.package.version,
      });

      inputs = await this.compilePackagePolicyInputs(pkgInfo, packagePolicy.vars || {}, inputs);
    }

    await soClient.update<PackagePolicySOAttributes>(
      SAVED_OBJECT_TYPE,
      id,
      {
        ...restOfPackagePolicy,
        inputs,
        revision: oldPackagePolicy.revision + 1,
        updated_at: new Date().toISOString(),
        updated_by: options?.user?.username ?? 'system',
      },
      {
        version,
      }
    );

    // Bump revision of associated agent policy
    await agentPolicyService.bumpRevision(soClient, esClient, packagePolicy.policy_id, {
      user: options?.user,
    });

    return (await this.get(soClient, id)) as PackagePolicy;
  }

  public async delete(
    soClient: SavedObjectsClientContract,
    esClient: ElasticsearchClient,
    ids: string[],
    options?: { user?: AuthenticatedUser; skipUnassignFromAgentPolicies?: boolean; force?: boolean }
  ): Promise<DeletePackagePoliciesResponse> {
    const result: DeletePackagePoliciesResponse = [];

    for (const id of ids) {
      try {
        const packagePolicy = await this.get(soClient, id);
        if (!packagePolicy) {
          throw new Error('Package policy not found');
        }
        if (!options?.skipUnassignFromAgentPolicies) {
          await agentPolicyService.unassignPackagePolicies(
            soClient,
            esClient,
            packagePolicy.policy_id,
            [packagePolicy.id],
            {
              user: options?.user,
              force: options?.force,
            }
          );
        }
        await soClient.delete(SAVED_OBJECT_TYPE, id);
        result.push({
          id,
          name: packagePolicy.name,
          success: true,
          package: {
            name: packagePolicy.name,
            title: '',
            version: packagePolicy.version || '',
          },
        });
      } catch (error) {
        result.push({
          id,
          success: false,
          ...ingestErrorToResponseOptions(error),
        });
      }
    }

    return result;
  }

  public async getUpgradePackagePolicyInfo(soClient: SavedObjectsClientContract, id: string) {
    const packagePolicy = await this.get(soClient, id);
    if (!packagePolicy) {
      throw new Error(
        i18n.translate('xpack.fleet.packagePolicy.policyNotFoundError', {
          defaultMessage: 'Package policy with id {id} not found',
          values: { id },
        })
      );
    }

    if (!packagePolicy.package?.name) {
      throw new Error(
        i18n.translate('xpack.fleet.packagePolicy.packageNotFoundError', {
          defaultMessage: 'Package policy with id {id} has no named package',
          values: { id },
        })
      );
    }

    const installedPackage = await getInstallation({
      savedObjectsClient: soClient,
      pkgName: packagePolicy.package.name,
    });
    if (!installedPackage) {
      throw new Error(
        i18n.translate('xpack.fleet.packagePolicy.packageNotInstalledError', {
          defaultMessage: 'Cannot upgrade package policy {id} because {pkgName} is not installed',
          values: { id, pkgName: packagePolicy.package.name },
        })
      );
    }

    const installedPkgInfo = await getPackageInfo({
      savedObjectsClient: soClient,
      pkgName: packagePolicy.package.name,
      pkgVersion: installedPackage.version,
    });

    return {
      packagePolicy: packagePolicy as Required<PackagePolicy>,
      installedPkgInfo,
    };
  }

  public async upgrade(
    soClient: SavedObjectsClientContract,
    esClient: ElasticsearchClient,
    ids: string[],
    options?: { user?: AuthenticatedUser }
  ): Promise<UpgradePackagePolicyResponse> {
    const result: UpgradePackagePolicyResponse = [];

    for (const id of ids) {
      try {
        const { packagePolicy, installedPkgInfo } = await this.getUpgradePackagePolicyInfo(
          soClient,
          id
        );

        const updatePackagePolicy = overridePackageInputs(
          {
            ...omit(packagePolicy, 'id'),
            inputs: packageToPackagePolicyInputs(installedPkgInfo),
            package: {
              ...packagePolicy.package,
              version: installedPkgInfo.version,
            },
          },
          packagePolicy.inputs as InputsOverride[]
        );

        updatePackagePolicy.inputs = await this.compilePackagePolicyInputs(
          installedPkgInfo,
          updatePackagePolicy.vars || {},
          updatePackagePolicy.inputs as PackagePolicyInput[]
        );

        await this.update(
          soClient,
          esClient,
          id,
          omit(updatePackagePolicy, 'missingVars'),
          options
        );
        result.push({
          id,
          name: packagePolicy.name,
          success: true,
        });
      } catch (error) {
        result.push({
          id,
          success: false,
          ...ingestErrorToResponseOptions(error),
        });
      }
    }

    return result;
  }

  public async getUpgradeDryRunDiff(
    soClient: SavedObjectsClientContract,
    id: string
  ): Promise<UpgradePackagePolicyDryRunResponseItem> {
    try {
      const { packagePolicy, installedPkgInfo } = await this.getUpgradePackagePolicyInfo(
        soClient,
        id
      );

      const updatedPackagePolicy = overridePackageInputs(
        {
          ...omit(packagePolicy, 'id'),
          inputs: packageToPackagePolicyInputs(installedPkgInfo),
          package: {
            ...packagePolicy.package,
            version: installedPkgInfo.version,
          },
        },
        packagePolicy.inputs as InputsOverride[],
        true
      );

      updatedPackagePolicy.inputs = await this.compilePackagePolicyInputs(
        installedPkgInfo,
        updatedPackagePolicy.vars || {},
        updatedPackagePolicy.inputs as PackagePolicyInput[]
      );

      const hasErrors = 'errors' in updatedPackagePolicy;

      return {
        name: updatedPackagePolicy.name,
        diff: [packagePolicy, updatedPackagePolicy],
        hasErrors,
      };
    } catch (error) {
      return {
        hasErrors: true,
        ...ingestErrorToResponseOptions(error),
      };
    }
  }

  public async buildPackagePolicyFromPackage(
    soClient: SavedObjectsClientContract,
    pkgName: string
  ): Promise<NewPackagePolicy | undefined> {
    const pkgInstall = await getInstallation({ savedObjectsClient: soClient, pkgName });
    if (pkgInstall) {
      const [packageInfo, defaultOutputId] = await Promise.all([
        getPackageInfo({
          savedObjectsClient: soClient,
          pkgName: pkgInstall.name,
          pkgVersion: pkgInstall.version,
        }),
        outputService.getDefaultOutputId(soClient),
      ]);
      if (packageInfo) {
        if (!defaultOutputId) {
          throw new Error('Default output is not set');
        }
        return packageToPackagePolicy(packageInfo, '', defaultOutputId);
      }
    }
  }

  public async compilePackagePolicyInputs(
    pkgInfo: PackageInfo,
    vars: PackagePolicy['vars'],
    inputs: PackagePolicyInput[]
  ): Promise<PackagePolicyInput[]> {
    const registryPkgInfo = await Registry.fetchInfo(pkgInfo.name, pkgInfo.version);
    const inputsPromises = inputs.map(async (input) => {
      const compiledInput = await _compilePackagePolicyInput(registryPkgInfo, pkgInfo, vars, input);
      const compiledStreams = await _compilePackageStreams(registryPkgInfo, pkgInfo, vars, input);
      return {
        ...input,
        compiled_input: compiledInput,
        streams: compiledStreams,
      };
    });

    return Promise.all(inputsPromises);
  }

  public async runExternalCallbacks<A extends ExternalCallback[0]>(
    externalCallbackType: A,
    packagePolicy: NewPackagePolicy | DeletePackagePoliciesResponse,
    context: RequestHandlerContext,
    request: KibanaRequest
  ): Promise<A extends 'postPackagePolicyDelete' ? void : NewPackagePolicy>;
  public async runExternalCallbacks(
    externalCallbackType: ExternalCallback[0],
    packagePolicy: NewPackagePolicy | DeletePackagePoliciesResponse,
    context: RequestHandlerContext,
    request: KibanaRequest
  ): Promise<NewPackagePolicy | void> {
    if (externalCallbackType === 'postPackagePolicyDelete') {
      const externalCallbacks = appContextService.getExternalCallbacks(externalCallbackType);
      if (externalCallbacks && externalCallbacks.size > 0) {
        for (const callback of externalCallbacks) {
          if (Array.isArray(packagePolicy)) {
            await callback(packagePolicy, context, request);
          }
        }
      }
    } else {
      if (!Array.isArray(packagePolicy)) {
        let newData = packagePolicy;
        const externalCallbacks = appContextService.getExternalCallbacks(externalCallbackType);
        if (externalCallbacks && externalCallbacks.size > 0) {
          let updatedNewData = newData;
          for (const callback of externalCallbacks) {
            const result = await callback(updatedNewData, context, request);
            if (externalCallbackType === 'packagePolicyCreate') {
              updatedNewData = NewPackagePolicySchema.validate(result);
            } else if (externalCallbackType === 'packagePolicyUpdate') {
              updatedNewData = UpdatePackagePolicySchema.validate(result);
            }
          }

          newData = updatedNewData;
        }
        return newData;
      }
    }
  }
}

function assignStreamIdToInput(packagePolicyId: string, input: NewPackagePolicyInput) {
  return {
    ...input,
    streams: input.streams.map((stream) => {
      return { ...stream, id: `${input.type}-${stream.data_stream.dataset}-${packagePolicyId}` };
    }),
  };
}

async function _compilePackagePolicyInput(
  registryPkgInfo: RegistryPackage,
  pkgInfo: PackageInfo,
  vars: PackagePolicy['vars'],
  input: PackagePolicyInput
) {
  const packagePolicyTemplate = input.policy_template
    ? pkgInfo.policy_templates?.find(
        (policyTemplate) => policyTemplate.name === input.policy_template
      )
    : pkgInfo.policy_templates?.[0];

  if (!input.enabled || !packagePolicyTemplate || !packagePolicyTemplate.inputs?.length) {
    return undefined;
  }

  const packageInputs = packagePolicyTemplate.inputs;
  const packageInput = packageInputs.find((pkgInput) => pkgInput.type === input.type);
  if (!packageInput) {
    throw new Error(`Input template not found, unable to find input type ${input.type}`);
  }

  if (!packageInput.template_path) {
    return undefined;
  }

  const [pkgInputTemplate] = await getAssetsData(registryPkgInfo, (path: string) =>
    path.endsWith(`/agent/input/${packageInput.template_path!}`)
  );

  if (!pkgInputTemplate || !pkgInputTemplate.buffer) {
    throw new Error(`Unable to load input template at /agent/input/${packageInput.template_path!}`);
  }

  return compileTemplate(
    // Populate template variables from package- and input-level vars
    Object.assign({}, vars, input.vars),
    pkgInputTemplate.buffer.toString()
  );
}

async function _compilePackageStreams(
  registryPkgInfo: RegistryPackage,
  pkgInfo: PackageInfo,
  vars: PackagePolicy['vars'],
  input: PackagePolicyInput
) {
  const streamsPromises = input.streams.map((stream) =>
    _compilePackageStream(registryPkgInfo, pkgInfo, vars, input, stream)
  );

  return await Promise.all(streamsPromises);
}

async function _compilePackageStream(
  registryPkgInfo: RegistryPackage,
  pkgInfo: PackageInfo,
  vars: PackagePolicy['vars'],
  input: PackagePolicyInput,
  stream: PackagePolicyInputStream
) {
  if (!stream.enabled) {
    return { ...stream, compiled_stream: undefined };
  }

  const packageDataStreams = pkgInfo.data_streams;
  if (!packageDataStreams) {
    throw new Error('Stream template not found, no data streams');
  }

  const packageDataStream = packageDataStreams.find(
    (pkgDataStream) => pkgDataStream.dataset === stream.data_stream.dataset
  );

  if (!packageDataStream) {
    throw new Error(
      `Stream template not found, unable to find dataset ${stream.data_stream.dataset}`
    );
  }

  const streamFromPkg = (packageDataStream.streams || []).find(
    (pkgStream) => pkgStream.input === input.type
  );
  if (!streamFromPkg) {
    throw new Error(`Stream template not found, unable to find stream for input ${input.type}`);
  }

  if (!streamFromPkg.template_path) {
    throw new Error(`Stream template path not found for dataset ${stream.data_stream.dataset}`);
  }

  const datasetPath = packageDataStream.path;

  const [pkgStreamTemplate] = await getAssetsData(
    registryPkgInfo,
    (path: string) => path.endsWith(streamFromPkg.template_path),
    datasetPath
  );

  if (!pkgStreamTemplate || !pkgStreamTemplate.buffer) {
    throw new Error(
      `Unable to load stream template ${streamFromPkg.template_path} for dataset ${stream.data_stream.dataset}`
    );
  }

  const yaml = compileTemplate(
    // Populate template variables from package-, input-, and stream-level vars
    Object.assign({}, vars, input.vars, stream.vars),
    pkgStreamTemplate.buffer.toString()
  );

  stream.compiled_stream = yaml;

  return { ...stream };
}

function enforceFrozenInputs(oldInputs: PackagePolicyInput[], newInputs: PackagePolicyInput[]) {
  const resultInputs = [...newInputs];

  for (const input of resultInputs) {
    const oldInput = oldInputs.find((i) => i.type === input.type);
    if (oldInput?.keep_enabled) input.enabled = oldInput.enabled;
    if (input.vars && oldInput?.vars) {
      input.vars = _enforceFrozenVars(oldInput.vars, input.vars);
    }
    if (input.streams && oldInput?.streams) {
      for (const stream of input.streams) {
        const oldStream = oldInput.streams.find((s) => s.id === stream.id);
        if (oldStream?.keep_enabled) stream.enabled = oldStream.enabled;
        if (stream.vars && oldStream?.vars) {
          stream.vars = _enforceFrozenVars(oldStream.vars, stream.vars);
        }
      }
    }
  }

  return resultInputs;
}

function _enforceFrozenVars(
  oldVars: Record<string, PackagePolicyConfigRecordEntry>,
  newVars: Record<string, PackagePolicyConfigRecordEntry>
) {
  const resultVars: Record<string, PackagePolicyConfigRecordEntry> = {};
  for (const [key, val] of Object.entries(newVars)) {
    if (oldVars[key]?.frozen) {
      resultVars[key] = oldVars[key];
    } else {
      resultVars[key] = val;
    }
  }
  for (const [key, val] of Object.entries(oldVars)) {
    if (!newVars[key] && val.frozen) {
      resultVars[key] = val;
    }
  }
  return resultVars;
}

export type PackagePolicyServiceInterface = PackagePolicyService;
export const packagePolicyService = new PackagePolicyService();

export type { PackagePolicyService };

export function overridePackageInputs(
  basePackagePolicy: NewPackagePolicy,
  inputsOverride?: InputsOverride[],
  dryRun?: boolean
): DryRunPackagePolicy {
  if (!inputsOverride) return basePackagePolicy;

  const inputs = [...basePackagePolicy.inputs];
  const packageName = basePackagePolicy.package!.name;
  const errors = [];
  let responseMissingVars: string[] = [];

  for (const override of inputsOverride) {
    let originalInput = inputs.find((i) => i.type === override.type);
    if (!originalInput) {
      const e = {
        error: new Error(
          i18n.translate('xpack.fleet.packagePolicyInputOverrideError', {
            defaultMessage: 'Input type {inputType} does not exist on package {packageName}',
            values: {
              inputType: override.type,
              packageName,
            },
          })
        ),
        package: { name: packageName, version: basePackagePolicy.package!.version },
      };
      if (dryRun) {
        errors.push({
          key: override.type,
          message: String(e.error),
        });
        continue;
      } else throw e;
    }

    if (typeof override.enabled !== 'undefined') originalInput.enabled = override.enabled;
    if (typeof override.keep_enabled !== 'undefined')
      originalInput.keep_enabled = override.keep_enabled;

    if (override.vars) {
      try {
        const { result, missingVars } = deepMergeVars(override, originalInput);
        originalInput = result;
        responseMissingVars = [...responseMissingVars, ...missingVars];
      } catch (e) {
        const varName = e.message;
        const err = {
          error: new Error(
            i18n.translate('xpack.fleet.packagePolicyVarOverrideError', {
              defaultMessage:
                'Var {varName} does not exist on {inputType} of package {packageName}',
              values: {
                varName,
                inputType: override.type,
                packageName,
              },
            })
          ),
          package: { name: packageName, version: basePackagePolicy.package!.version },
        };
        if (dryRun) {
          errors.push({
            key: `${override.type}.vars.${varName}`,
            message: String(err.error),
          });
        } else throw err;
      }
    }

    if (override.streams) {
      for (const stream of override.streams) {
        let originalStream = originalInput?.streams.find(
          (s) => s.data_stream.dataset === stream.data_stream.dataset
        );
        if (!originalStream) {
          const streamSet = stream.data_stream.dataset;
          const e = {
            error: new Error(
              i18n.translate('xpack.fleet.packagePolicyStreamOverrideError', {
                defaultMessage:
                  'Data stream {streamSet} does not exist on {inputType} of package {packageName}',
                values: {
                  streamSet,
                  inputType: override.type,
                  packageName,
                },
              })
            ),
            package: { name: packageName, version: basePackagePolicy.package!.version },
          };
          if (dryRun) {
            errors.push({
              key: `${override.type}.streams.${streamSet}`,
              message: String(e.error),
            });
            continue;
          } else throw e;
        }

        if (typeof stream.enabled !== 'undefined') originalStream.enabled = stream.enabled;

        if (stream.vars) {
          try {
            const { result, missingVars } = deepMergeVars(stream as InputsOverride, originalStream);
            originalStream = result;
            responseMissingVars = [...responseMissingVars, ...missingVars];
          } catch (e) {
            const varName = e.message;
            const streamSet = stream.data_stream.dataset;
            const err = {
              error: new Error(
                i18n.translate('xpack.fleet.packagePolicyStreamVarOverrideError', {
                  defaultMessage:
                    'Var {varName} does not exist on {streamSet} for {inputType} of package {packageName}',
                  values: {
                    varName,
                    streamSet,
                    inputType: override.type,
                    packageName,
                  },
                })
              ),
              package: { name: packageName, version: basePackagePolicy.package!.version },
            };
            if (dryRun) {
              errors.push({
                key: `${override.type}.streams.${streamSet}.${varName}`,
                message: String(err.error),
              });
            } else throw err;
          }
        }
      }
    }
  }

  if (dryRun && errors.length) {
    return { ...basePackagePolicy, inputs, errors, missingVars: responseMissingVars };
  }

  return { ...basePackagePolicy, inputs, missingVars: responseMissingVars };
}

function deepMergeVars(override: any, original: any): { result: any; missingVars: string[] } {
  const result = { ...original };
  const missingVars: string[] = [];

  const overrideVars = Array.isArray(override.vars)
    ? override.vars
    : Object.entries(override.vars!).map(([key, rest]) => ({
        name: key,
        ...(rest as any),
      }));

  for (const { name, ...val } of overrideVars) {
    if (!original.vars || !(name in original.vars)) {
      missingVars.push(name);
      continue;
    }

    const originalVar = original.vars[name];
    result[name] = { ...originalVar, ...val };
  }

  return { result, missingVars };
}
