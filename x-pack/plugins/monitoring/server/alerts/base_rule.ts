/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { Logger, ElasticsearchClient } from 'kibana/server';
import { i18n } from '@kbn/i18n';
import {
  AlertType,
  AlertExecutorOptions,
  AlertInstance,
  RulesClient,
  AlertServices,
} from '../../../alerting/server';
import { Alert, AlertTypeParams, RawAlertInstance, SanitizedAlert } from '../../../alerting/common';
import { ActionsClient } from '../../../actions/server';
import {
  AlertState,
  AlertNodeState,
  AlertCluster,
  AlertMessage,
  AlertData,
  AlertInstanceState,
  AlertEnableAction,
  CommonAlertFilter,
  CommonAlertParams,
} from '../../common/types/alerts';
import { fetchAvailableCcs } from '../lib/alerts/fetch_available_ccs';
import { fetchClusters } from '../lib/alerts/fetch_clusters';
import { getCcsIndexPattern } from '../lib/alerts/get_ccs_index_pattern';
import { INDEX_PATTERN_ELASTICSEARCH } from '../../common/constants';
import { AlertSeverity } from '../../common/enums';
import { appendMetricbeatIndex } from '../lib/alerts/append_mb_index';
import { parseDuration } from '../../../alerting/common/parse_duration';
import { Globals } from '../static_globals';

type ExecutedState =
  | {
      lastChecked: number;
      lastExecutedAction: number;
      [key: string]: unknown;
    }
  | Record<string, any>;

interface RuleOptions {
  id: string;
  name: string;
  throttle?: string | null;
  interval?: string;
  defaultParams?: Partial<CommonAlertParams>;
  actionVariables: Array<{ name: string; description: string }>;
  fetchClustersRange?: number;
  accessorKey?: string;
}

const defaultRuleOptions = (): RuleOptions => {
  return {
    id: '',
    name: '',
    throttle: '1d',
    interval: '1m',
    defaultParams: { threshold: 85, duration: '1h' },
    actionVariables: [],
  };
};
export class BaseRule {
  protected scopedLogger: Logger;

  constructor(
    public sanitizedRule?: SanitizedAlert,
    public ruleOptions: RuleOptions = defaultRuleOptions()
  ) {
    const defaultOptions = defaultRuleOptions();
    defaultOptions.defaultParams = {
      ...defaultOptions.defaultParams,
      ...this.ruleOptions.defaultParams,
    };
    this.ruleOptions = { ...defaultOptions, ...this.ruleOptions };
    this.scopedLogger = Globals.app.getLogger(ruleOptions.id);
  }

  public getRuleType(): AlertType<never, never, never, never, never, 'default'> {
    const { id, name, actionVariables } = this.ruleOptions;
    return {
      id,
      name,
      actionGroups: [
        {
          id: 'default',
          name: i18n.translate('xpack.monitoring.alerts.actionGroups.default', {
            defaultMessage: 'Default',
          }),
        },
      ],
      defaultActionGroupId: 'default',
      minimumLicenseRequired: 'basic',
      isExportable: false,
      executor: (
        options: AlertExecutorOptions<never, never, AlertInstanceState, never, 'default'> & {
          state: ExecutedState;
        }
      ): Promise<any> => this.execute(options),
      producer: 'monitoring',
      actionVariables: {
        context: actionVariables,
      },
    };
  }

  public getId() {
    return this.sanitizedRule?.id;
  }

  public async createIfDoesNotExist(
    rulesClient: RulesClient,
    actionsClient: ActionsClient,
    actions: AlertEnableAction[]
  ): Promise<SanitizedAlert<AlertTypeParams>> {
    const existingRuleData = await rulesClient.find({
      options: {
        search: this.ruleOptions.id,
      },
    });

    if (existingRuleData.total > 0) {
      const existingRule = existingRuleData.data[0] as Alert;
      return existingRule;
    }

    const ruleActions = [];
    for (const actionData of actions) {
      const action = await actionsClient.get({ id: actionData.id });
      if (!action) {
        continue;
      }
      ruleActions.push({
        group: 'default',
        id: actionData.id,
        params: {
          message: '{{context.internalShortMessage}}',
          ...actionData.config,
        },
      });
    }

    const {
      defaultParams: params = {},
      name,
      id: alertTypeId,
      throttle = '1d',
      interval = '1m',
    } = this.ruleOptions;
    return await rulesClient.create<AlertTypeParams>({
      data: {
        enabled: true,
        tags: [],
        params,
        consumer: 'monitoring',
        name,
        alertTypeId,
        throttle,
        notifyWhen: null,
        schedule: { interval },
        actions: ruleActions,
      },
    });
  }

  public async getStates(
    rulesClient: RulesClient,
    id: string,
    filters: CommonAlertFilter[]
  ): Promise<{ [instanceId: string]: RawAlertInstance }> {
    const states = await rulesClient.getAlertState({ id });
    if (!states || !states.alertInstances) {
      return {};
    }

    return Object.keys(states.alertInstances).reduce(
      (accum: { [instanceId: string]: RawAlertInstance }, instanceId) => {
        if (!states.alertInstances) {
          return accum;
        }
        const alertInstance: RawAlertInstance = states.alertInstances[instanceId];
        const filteredAlertInstance = this.filterAlertInstance(alertInstance, filters);
        if (filteredAlertInstance) {
          accum[instanceId] = filteredAlertInstance as RawAlertInstance;
          if (filteredAlertInstance.state) {
            accum[instanceId].state = {
              alertStates: (filteredAlertInstance.state as AlertInstanceState).alertStates,
            };
          }
        }
        return accum;
      },
      {}
    );
  }

  protected filterAlertInstance(
    alertInstance: RawAlertInstance,
    filters: CommonAlertFilter[],
    filterOnNodes: boolean = false
  ) {
    if (!filterOnNodes) {
      return alertInstance;
    }
    const alertInstanceStates = alertInstance.state?.alertStates as AlertNodeState[];
    const nodeFilter = filters?.find((filter) => filter.nodeUuid);
    if (!filters || !filters.length || !alertInstanceStates?.length || !nodeFilter?.nodeUuid) {
      return alertInstance;
    }
    const alertStates = alertInstanceStates.filter(({ nodeId }) => nodeId === nodeFilter.nodeUuid);
    return { state: { alertStates } };
  }

  protected async execute({
    services,
    params,
    state,
  }: AlertExecutorOptions<never, never, AlertInstanceState, never, 'default'> & {
    state: ExecutedState;
  }): Promise<any> {
    this.scopedLogger.debug(
      `Executing alert with params: ${JSON.stringify(params)} and state: ${JSON.stringify(state)}`
    );

    const esClient = services.scopedClusterClient.asCurrentUser;
    const availableCcs = Globals.app.config.ui.ccs.enabled ? await fetchAvailableCcs(esClient) : [];
    const clusters = await this.fetchClusters(esClient, params as CommonAlertParams, availableCcs);
    const data = await this.fetchData(params, esClient, clusters, availableCcs);
    return await this.processData(data, clusters, services, state);
  }

  protected async fetchClusters(
    esClient: ElasticsearchClient,
    params: CommonAlertParams,
    ccs?: string[]
  ) {
    let esIndexPattern = appendMetricbeatIndex(Globals.app.config, INDEX_PATTERN_ELASTICSEARCH);
    if (ccs?.length) {
      esIndexPattern = getCcsIndexPattern(esIndexPattern, ccs);
    }
    if (!params.limit) {
      return await fetchClusters(esClient, esIndexPattern);
    }
    const limit = parseDuration(params.limit);
    const rangeFilter = this.ruleOptions.fetchClustersRange
      ? {
          timestamp: {
            format: 'epoch_millis',
            gte: +new Date() - limit - this.ruleOptions.fetchClustersRange,
          },
        }
      : undefined;
    return await fetchClusters(esClient, esIndexPattern, rangeFilter);
  }

  protected async fetchData(
    params: CommonAlertParams | unknown,
    esClient: ElasticsearchClient,
    clusters: AlertCluster[],
    availableCcs: string[]
  ): Promise<Array<AlertData & unknown>> {
    throw new Error('Child classes must implement `fetchData`');
  }

  protected async processData(
    data: AlertData[],
    clusters: AlertCluster[],
    services: AlertServices<AlertInstanceState, never, 'default'>,
    state: ExecutedState
  ) {
    const currentUTC = +new Date();
    // for each cluster filter the nodes that belong to this cluster
    for (const cluster of clusters) {
      const nodes = data.filter((node) => node.clusterUuid === cluster.clusterUuid);
      if (!nodes.length) {
        continue;
      }

      const key = this.ruleOptions.accessorKey;

      // for each node, update the alert's state with node state
      for (const node of nodes) {
        const newAlertStates: AlertNodeState[] = [];
        // quick fix for now so that non node level alerts will use the cluster id
        const instance = services.alertInstanceFactory(
          node.meta.nodeId || node.meta.instanceId || cluster.clusterUuid
        );

        if (node.shouldFire) {
          const { meta } = node;
          // create a default alert state for this node and add data from node.meta and other data
          const nodeState = this.getDefaultAlertState(cluster, node) as AlertNodeState;
          if (key) {
            nodeState[key] = meta[key];
          }
          nodeState.nodeId = meta.nodeId || node.nodeId! || meta.instanceId;
          // TODO: make these functions more generic, so it's node/item agnostic
          nodeState.nodeName = meta.itemLabel || meta.nodeName || node.nodeName || nodeState.nodeId;
          nodeState.itemLabel = meta.itemLabel;
          nodeState.meta = meta;
          nodeState.ui.triggeredMS = currentUTC;
          nodeState.ui.isFiring = true;
          nodeState.ui.severity = node.severity;
          nodeState.ui.message = this.getUiMessage(nodeState, node);
          // store the state of each node in array.
          newAlertStates.push(nodeState);
        }
        const alertInstanceState = { alertStates: newAlertStates };
        // update the alert's state with the new node states
        instance.replaceState(alertInstanceState);
        if (newAlertStates.length) {
          this.executeActions(instance, alertInstanceState, null, cluster);
          state.lastExecutedAction = currentUTC;
        }
      }
    }

    state.lastChecked = currentUTC;
    return state;
  }

  protected getDefaultAlertState(cluster: AlertCluster, item: AlertData): AlertState {
    return {
      cluster,
      ccs: item.ccs,
      ui: {
        isFiring: false,
        message: null,
        severity: AlertSeverity.Success,
        triggeredMS: 0,
        lastCheckedMS: 0,
      },
    };
  }

  protected getUiMessage(
    alertState: AlertState | unknown,
    item: AlertData | unknown
  ): AlertMessage {
    throw new Error('Child classes must implement `getUiMessage`');
  }

  protected executeActions(
    instance: AlertInstance,
    instanceState: AlertInstanceState | AlertState | unknown,
    item: AlertData | unknown,
    cluster?: AlertCluster | unknown
  ) {
    throw new Error('Child classes must implement `executeActions`');
  }

  protected createGlobalStateLink(link: string, clusterUuid: string, ccs?: string) {
    const globalState = [`cluster_uuid:${clusterUuid}`];
    if (ccs) {
      globalState.push(`ccs:${ccs}`);
    }
    return `${Globals.app.url}/app/monitoring#/${link}?_g=(${globalState.toString()})`;
  }
}
