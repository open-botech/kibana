/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  buildRuleStatusAttributes,
  RuleStatusService,
  ruleStatusServiceFactory,
  MAX_RULE_STATUSES,
} from './rule_status_service';
import { exampleRuleStatus, exampleFindRuleStatusResponse } from './__mocks__/es_results';
import { RuleExecutionStatus } from '../../../../common/detection_engine/schemas/common/schemas';
import { RuleExecutionLogClient } from '../rule_execution_log/__mocks__/rule_execution_log_client';
import { UpdateExecutionLogArgs } from '../rule_execution_log/types';

const expectIsoDateString = expect.stringMatching(/2.*Z$/);
const buildStatuses = (n: number) =>
  Array(n)
    .fill(exampleRuleStatus())
    .map((status, index) => ({
      ...status,
      id: `status-index-${index}`,
    }));

describe('buildRuleStatusAttributes', () => {
  it('generates a new date on each call', async () => {
    const { statusDate } = buildRuleStatusAttributes(RuleExecutionStatus['going to run']);
    await new Promise((resolve) => setTimeout(resolve, 10)); // ensure time has passed
    const { statusDate: statusDate2 } = buildRuleStatusAttributes(
      RuleExecutionStatus['going to run']
    );

    expect(statusDate).toEqual(expectIsoDateString);
    expect(statusDate2).toEqual(expectIsoDateString);
    expect(statusDate).not.toEqual(statusDate2);
  });

  it('returns a status and statusDate if "going to run"', () => {
    const result = buildRuleStatusAttributes(RuleExecutionStatus['going to run']);
    expect(result).toEqual({
      status: 'going to run',
      statusDate: expectIsoDateString,
    });
  });

  it('returns success fields if "success"', () => {
    const result = buildRuleStatusAttributes(RuleExecutionStatus.succeeded, 'success message');
    expect(result).toEqual({
      status: 'succeeded',
      statusDate: expectIsoDateString,
      lastSuccessAt: expectIsoDateString,
      lastSuccessMessage: 'success message',
    });

    expect(result.statusDate).toEqual(result.lastSuccessAt);
  });

  it('returns warning fields if "warning"', () => {
    const result = buildRuleStatusAttributes(
      RuleExecutionStatus.warning,
      'some indices missing timestamp override field'
    );
    expect(result).toEqual({
      status: 'warning',
      statusDate: expectIsoDateString,
      lastSuccessAt: expectIsoDateString,
      lastSuccessMessage: 'some indices missing timestamp override field',
    });

    expect(result.statusDate).toEqual(result.lastSuccessAt);
  });

  it('returns failure fields if "failed"', () => {
    const result = buildRuleStatusAttributes(RuleExecutionStatus.failed, 'failure message');
    expect(result).toEqual({
      status: 'failed',
      statusDate: expectIsoDateString,
      lastFailureAt: expectIsoDateString,
      lastFailureMessage: 'failure message',
    });

    expect(result.statusDate).toEqual(result.lastFailureAt);
  });
});

describe('ruleStatusService', () => {
  let currentStatus: ReturnType<typeof exampleRuleStatus>;
  let ruleStatusClient: ReturnType<typeof RuleExecutionLogClient>;
  let service: RuleStatusService;

  beforeEach(async () => {
    currentStatus = exampleRuleStatus();
    ruleStatusClient = new RuleExecutionLogClient();
    ruleStatusClient.find.mockResolvedValue(exampleFindRuleStatusResponse([currentStatus]));
    service = await ruleStatusServiceFactory({
      alertId: 'mock-alert-id',
      ruleStatusClient,
      spaceId: 'default',
    });
  });

  describe('goingToRun', () => {
    it('updates the current status to "going to run"', async () => {
      await service.goingToRun();

      expect(ruleStatusClient.update).toHaveBeenCalledWith<[UpdateExecutionLogArgs]>({
        id: currentStatus.id,
        spaceId: 'default',
        attributes: expect.objectContaining({
          status: 'going to run',
          statusDate: expectIsoDateString,
        }),
      });
    });
  });

  describe('success', () => {
    it('updates the current status to "succeeded"', async () => {
      await service.success('hey, it worked');

      expect(ruleStatusClient.update).toHaveBeenCalledWith<[UpdateExecutionLogArgs]>({
        id: currentStatus.id,
        spaceId: 'default',
        attributes: expect.objectContaining({
          status: 'succeeded',
          statusDate: expectIsoDateString,
          lastSuccessAt: expectIsoDateString,
          lastSuccessMessage: 'hey, it worked',
        }),
      });
    });
  });

  describe('error', () => {
    beforeEach(() => {
      // mock the creation of our new status
      ruleStatusClient.create.mockResolvedValue(exampleRuleStatus());
    });

    it('updates the current status to "failed"', async () => {
      await service.error('oh no, it broke');

      expect(ruleStatusClient.update).toHaveBeenCalledWith<[UpdateExecutionLogArgs]>({
        id: currentStatus.id,
        spaceId: 'default',
        attributes: expect.objectContaining({
          status: 'failed',
          statusDate: expectIsoDateString,
          lastFailureAt: expectIsoDateString,
          lastFailureMessage: 'oh no, it broke',
        }),
      });
    });

    it('does not delete statuses if we have less than the max number of statuses', async () => {
      await service.error('oh no, it broke');

      expect(ruleStatusClient.delete).not.toHaveBeenCalled();
    });

    it('does not delete rule statuses when we just hit the limit', async () => {
      // max - 1 in store, meaning our new error will put us at max
      ruleStatusClient.find.mockResolvedValue(
        exampleFindRuleStatusResponse(buildStatuses(MAX_RULE_STATUSES - 1))
      );
      service = await ruleStatusServiceFactory({
        alertId: 'mock-alert-id',
        ruleStatusClient,
        spaceId: 'default',
      });

      await service.error('oh no, it broke');

      expect(ruleStatusClient.delete).not.toHaveBeenCalled();
    });

    it('deletes stale rule status when we already have max statuses', async () => {
      // max in store, meaning our new error will push one off the end
      ruleStatusClient.find.mockResolvedValue(
        exampleFindRuleStatusResponse(buildStatuses(MAX_RULE_STATUSES))
      );
      service = await ruleStatusServiceFactory({
        alertId: 'mock-alert-id',
        ruleStatusClient,
        spaceId: 'default',
      });

      await service.error('oh no, it broke');

      expect(ruleStatusClient.delete).toHaveBeenCalledTimes(1);
      // we should delete the 6th (index 5)
      expect(ruleStatusClient.delete).toHaveBeenCalledWith('status-index-5');
    });

    it('deletes any number of rule statuses in excess of the max', async () => {
      // max + 1 in store, meaning our new error will put us two over
      ruleStatusClient.find.mockResolvedValue(
        exampleFindRuleStatusResponse(buildStatuses(MAX_RULE_STATUSES + 1))
      );
      service = await ruleStatusServiceFactory({
        alertId: 'mock-alert-id',
        ruleStatusClient,
        spaceId: 'default',
      });

      await service.error('oh no, it broke');

      expect(ruleStatusClient.delete).toHaveBeenCalledTimes(2);
      // we should delete the 6th (index 5)
      expect(ruleStatusClient.delete).toHaveBeenCalledWith('status-index-5');
      // we should delete the 7th (index 6)
      expect(ruleStatusClient.delete).toHaveBeenCalledWith('status-index-6');
    });

    it('handles multiple error calls', async () => {
      // max in store, meaning our new error will push one off the end
      ruleStatusClient.find.mockResolvedValue(
        exampleFindRuleStatusResponse(buildStatuses(MAX_RULE_STATUSES))
      );
      service = await ruleStatusServiceFactory({
        alertId: 'mock-alert-id',
        ruleStatusClient,
        spaceId: 'default',
      });

      await service.error('oh no, it broke');
      await service.error('oh no, it broke');

      expect(ruleStatusClient.delete).toHaveBeenCalledTimes(2);
      // we should delete the 6th (index 5)
      expect(ruleStatusClient.delete).toHaveBeenCalledWith('status-index-5');
      expect(ruleStatusClient.delete).toHaveBeenCalledWith('status-index-5');
    });
  });
});
