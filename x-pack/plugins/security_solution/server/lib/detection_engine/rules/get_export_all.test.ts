/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  getAlertMock,
  getFindResultWithSingleHit,
  FindHit,
} from '../routes/__mocks__/request_responses';
import { rulesClientMock } from '../../../../../alerting/server/mocks';
import { getExportAll } from './get_export_all';
import { getListArrayMock } from '../../../../common/detection_engine/schemas/types/lists.mock';
import { getThreatMock } from '../../../../common/detection_engine/schemas/types/threat.mock';
import { getQueryRuleParams } from '../schemas/rule_schemas.mock';

describe('getExportAll', () => {
  test('it exports everything from the alerts client', async () => {
    const rulesClient = rulesClientMock.create();
    const result = getFindResultWithSingleHit();
    const alert = getAlertMock(getQueryRuleParams());
    alert.params = {
      ...alert.params,
      filters: [{ query: { match_phrase: { 'host.name': 'some-host' } } }],
      threat: getThreatMock(),
      meta: { someMeta: 'someField' },
      timelineId: 'some-timeline-id',
      timelineTitle: 'some-timeline-title',
    };
    result.data = [alert];
    rulesClient.find.mockResolvedValue(result);

    const exports = await getExportAll(rulesClient);
    const rulesJson = JSON.parse(exports.rulesNdjson);
    const detailsJson = JSON.parse(exports.exportDetails);
    expect(rulesJson).toEqual({
      author: ['Elastic'],
      actions: [],
      building_block_type: 'default',
      created_at: '2019-12-13T16:40:33.400Z',
      updated_at: '2019-12-13T16:40:33.400Z',
      created_by: 'elastic',
      description: 'Detecting root and admin users',
      enabled: true,
      false_positives: [],
      filters: [{ query: { match_phrase: { 'host.name': 'some-host' } } }],
      from: 'now-6m',
      id: '04128c15-0d1b-4716-a4c5-46997ac7f3bd',
      immutable: false,
      index: ['auditbeat-*', 'filebeat-*', 'packetbeat-*', 'winlogbeat-*'],
      interval: '5m',
      rule_id: 'rule-1',
      language: 'kuery',
      license: 'Elastic License',
      output_index: '.siem-signals',
      max_signals: 10000,
      risk_score: 50,
      risk_score_mapping: [],
      name: 'Detect Root/Admin Users',
      query: 'user.name: root or user.name: admin',
      references: ['http://example.com', 'https://example.com'],
      timeline_id: 'some-timeline-id',
      timeline_title: 'some-timeline-title',
      meta: { someMeta: 'someField' },
      severity: 'high',
      severity_mapping: [],
      updated_by: 'elastic',
      tags: [],
      to: 'now',
      type: 'query',
      threat: getThreatMock(),
      throttle: 'no_actions',
      note: '# Investigative notes',
      version: 1,
      exceptions_list: getListArrayMock(),
    });
    expect(detailsJson).toEqual({
      exported_count: 1,
      missing_rules: [],
      missing_rules_count: 0,
    });
  });

  test('it will export empty rules', async () => {
    const rulesClient = rulesClientMock.create();
    const findResult: FindHit = {
      page: 1,
      perPage: 1,
      total: 0,
      data: [],
    };

    rulesClient.find.mockResolvedValue(findResult);

    const exports = await getExportAll(rulesClient);
    expect(exports).toEqual({
      rulesNdjson: '',
      exportDetails: '{"exported_count":0,"missing_rules":[],"missing_rules_count":0}\n',
    });
  });
});
