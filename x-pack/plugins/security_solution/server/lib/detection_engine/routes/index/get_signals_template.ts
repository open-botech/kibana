/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  SPACE_IDS,
  ALERT_RULE_CONSUMER,
  ALERT_RULE_PRODUCER,
  ALERT_RULE_TYPE_ID,
} from '@kbn/rule-data-utils';
import signalsMapping from './signals_mapping.json';
import ecsMapping from './ecs_mapping.json';
import otherMapping from './other_mappings.json';
import aadFieldConversion from './signal_aad_mapping.json';

/**
  @constant
  @type {number}
  @description This value represents the template version assumed by app code.
  If this number is greater than the user's signals index version, the
  detections UI will attempt to update the signals template and roll over to
  a new signals index.

  If making mappings changes in a patch release, this number should be incremented by 1.
  If making mappings changes in a minor release, this number should be
  incremented by 10 in order to add "room" for the aforementioned patch
  release
*/
export const SIGNALS_TEMPLATE_VERSION = 55;
/**
  @constant
  @type {number}
  @description This value represents the version of the field aliases that map the new field names
  used for alerts-as-data to the old signal.* field names. If any .siem-signals-<space id> indices
  have an aliases_version less than this value, the detections UI will call create_index_route and
  and go through the index update process. Increment this number if making changes to the field
  aliases we use to make signals forwards-compatible.
*/
export const SIGNALS_FIELD_ALIASES_VERSION = 1;
export const MIN_EQL_RULE_INDEX_VERSION = 2;
export const ALIAS_VERSION_FIELD = 'aliases_version';

export const getSignalsTemplate = (index: string, spaceId: string, aadIndexAliasName: string) => {
  const fieldAliases = createSignalsFieldAliases();
  const template = {
    index_patterns: [`${index}-*`],
    template: {
      aliases: {
        [aadIndexAliasName]: {
          is_write_index: false,
        },
      },
      settings: {
        index: {
          lifecycle: {
            name: index,
            rollover_alias: index,
          },
        },
        mapping: {
          total_fields: {
            limit: 10000,
          },
        },
      },
      mappings: {
        dynamic: false,
        properties: {
          ...ecsMapping.mappings.properties,
          ...otherMapping.mappings.properties,
          ...fieldAliases,
          ...getRbacRequiredFields(spaceId),
          signal: signalsMapping.mappings.properties.signal,
          threat: {
            ...ecsMapping.mappings.properties.threat,
            properties: {
              ...ecsMapping.mappings.properties.threat.properties,
              indicator: {
                ...otherMapping.mappings.properties.threat.properties.indicator,
                properties: {
                  ...otherMapping.mappings.properties.threat.properties.indicator.properties,
                  event: ecsMapping.mappings.properties.event,
                },
              },
            },
          },
        },
        _meta: {
          version: SIGNALS_TEMPLATE_VERSION,
          [ALIAS_VERSION_FIELD]: SIGNALS_FIELD_ALIASES_VERSION,
        },
      },
    },
    version: SIGNALS_TEMPLATE_VERSION,
  };
  return template;
};

export const createSignalsFieldAliases = () => {
  const fieldAliases: Record<string, unknown> = {};
  Object.entries(aadFieldConversion).forEach(([key, value]) => {
    fieldAliases[value] = {
      type: 'alias',
      path: key,
    };
  });
  return fieldAliases;
};

export const getRbacRequiredFields = (spaceId: string) => {
  return {
    [SPACE_IDS]: {
      type: 'constant_keyword',
      value: spaceId,
    },
    [ALERT_RULE_CONSUMER]: {
      type: 'constant_keyword',
      value: 'siem',
    },
    [ALERT_RULE_PRODUCER]: {
      type: 'constant_keyword',
      value: 'siem',
    },
    // TODO: discuss naming of this field and what the value will be for legacy signals.
    // Can we leave it as 'siem.signals' or do we need a runtime field that will map signal.rule.type
    // to the new ruleTypeId?
    [ALERT_RULE_TYPE_ID]: {
      type: 'constant_keyword',
      value: 'siem.signals',
    },
  };
};
