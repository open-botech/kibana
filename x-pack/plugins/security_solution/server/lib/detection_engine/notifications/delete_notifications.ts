/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { readNotifications } from './read_notifications';
import { DeleteNotificationParams } from './types';

export const deleteNotifications = async ({
  rulesClient,
  id,
  ruleAlertId,
}: DeleteNotificationParams) => {
  const notification = await readNotifications({ rulesClient, id, ruleAlertId });
  if (notification == null) {
    return null;
  }

  if (notification.id != null) {
    await rulesClient.delete({ id: notification.id });
    return notification;
  } else if (id != null) {
    try {
      await rulesClient.delete({ id });
      return notification;
    } catch (err) {
      if (err.output.statusCode === 404) {
        return null;
      } else {
        throw err;
      }
    }
  } else {
    return null;
  }
};
