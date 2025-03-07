/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { rulesClientMock } from '../../../../../alerting/server/mocks';
import { updateNotifications } from './update_notifications';
import { readNotifications } from './read_notifications';
import { createNotifications } from './create_notifications';
import { getNotificationResult } from '../routes/__mocks__/request_responses';
import { UpdateNotificationParams } from './types';
jest.mock('./read_notifications');
jest.mock('./create_notifications');

describe('updateNotifications', () => {
  const notification = getNotificationResult();
  let rulesClient: ReturnType<typeof rulesClientMock.create>;

  beforeEach(() => {
    rulesClient = rulesClientMock.create();
  });

  it('should update the existing notification if interval provided', async () => {
    (readNotifications as jest.Mock).mockResolvedValue(notification);

    await updateNotifications({
      rulesClient,
      actions: [],
      ruleAlertId: 'new-rule-id',
      enabled: true,
      interval: '10m',
      name: '',
    });

    expect(rulesClient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: notification.id,
        data: expect.objectContaining({
          params: expect.objectContaining({
            ruleAlertId: 'new-rule-id',
          }),
        }),
      })
    );
  });

  it('should create a new notification if did not exist', async () => {
    (readNotifications as jest.Mock).mockResolvedValue(null);

    const params: UpdateNotificationParams = {
      rulesClient,
      actions: [],
      ruleAlertId: 'new-rule-id',
      enabled: true,
      interval: '10m',
      name: '',
    };

    await updateNotifications(params);

    expect(createNotifications).toHaveBeenCalledWith(expect.objectContaining(params));
  });

  it('should delete notification if notification was found and interval is null', async () => {
    (readNotifications as jest.Mock).mockResolvedValue(notification);

    await updateNotifications({
      rulesClient,
      actions: [],
      ruleAlertId: 'new-rule-id',
      enabled: true,
      interval: null,
      name: '',
    });

    expect(rulesClient.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        id: notification.id,
      })
    );
  });

  it('should call the rulesClient with transformed actions', async () => {
    (readNotifications as jest.Mock).mockResolvedValue(notification);
    const action = {
      group: 'default',
      id: '99403909-ca9b-49ba-9d7a-7e5320e68d05',
      params: { message: 'Rule generated {{state.signals_count}} signals' },
      action_type_id: '.slack',
    };
    await updateNotifications({
      rulesClient,
      actions: [action],
      ruleAlertId: 'new-rule-id',
      enabled: true,
      interval: '10m',
      name: '',
    });

    expect(rulesClient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actions: expect.arrayContaining([
            {
              group: action.group,
              id: action.id,
              params: action.params,
              actionTypeId: '.slack',
            },
          ]),
        }),
      })
    );
  });

  it('returns null if notification was not found and interval was null', async () => {
    (readNotifications as jest.Mock).mockResolvedValue(null);
    const ruleAlertId = 'rule-04128c15-0d1b-4716-a4c5-46997ac7f3bd';

    const result = await updateNotifications({
      rulesClient,
      actions: [],
      enabled: true,
      ruleAlertId,
      name: notification.name,
      interval: null,
    });

    expect(result).toEqual(null);
  });
});
