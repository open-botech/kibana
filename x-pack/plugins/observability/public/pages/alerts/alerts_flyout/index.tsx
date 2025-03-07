/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  EuiButton,
  EuiDescriptionList,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiFlyoutHeader,
  EuiFlyoutProps,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type {
  ALERT_DURATION as ALERT_DURATION_TYPED,
  ALERT_EVALUATION_THRESHOLD as ALERT_EVALUATION_THRESHOLD_TYPED,
  ALERT_EVALUATION_VALUE as ALERT_EVALUATION_VALUE_TYPED,
  ALERT_SEVERITY_LEVEL as ALERT_SEVERITY_LEVEL_TYPED,
  ALERT_UUID as ALERT_UUID_TYPED,
  ALERT_RULE_CATEGORY as ALERT_RULE_CATEGORY_TYPED,
  ALERT_RULE_NAME as ALERT_RULE_NAME_TYPED,
} from '@kbn/rule-data-utils';
import {
  ALERT_DURATION as ALERT_DURATION_NON_TYPED,
  ALERT_EVALUATION_THRESHOLD as ALERT_EVALUATION_THRESHOLD_NON_TYPED,
  ALERT_EVALUATION_VALUE as ALERT_EVALUATION_VALUE_NON_TYPED,
  ALERT_SEVERITY_LEVEL as ALERT_SEVERITY_LEVEL_NON_TYPED,
  ALERT_UUID as ALERT_UUID_NON_TYPED,
  ALERT_RULE_CATEGORY as ALERT_RULE_CATEGORY_NON_TYPED,
  ALERT_RULE_NAME as ALERT_RULE_NAME_NON_TYPED,
  // @ts-expect-error
} from '@kbn/rule-data-utils/target_node/technical_field_names';
import moment from 'moment-timezone';
import React, { useMemo } from 'react';
import type { TopAlert, TopAlertResponse } from '../';
import { useKibana, useUiSetting } from '../../../../../../../src/plugins/kibana_react/public';
import { asDuration } from '../../../../common/utils/formatters';
import type { ObservabilityRuleTypeRegistry } from '../../../rules/create_observability_rule_type_registry';
import { decorateResponse } from '../decorate_response';
import { SeverityBadge } from '../severity_badge';

type AlertsFlyoutProps = {
  alert?: TopAlert;
  alerts?: TopAlertResponse[];
  isInApp?: boolean;
  observabilityRuleTypeRegistry: ObservabilityRuleTypeRegistry;
  selectedAlertId?: string;
} & EuiFlyoutProps;

const ALERT_DURATION: typeof ALERT_DURATION_TYPED = ALERT_DURATION_NON_TYPED;
const ALERT_EVALUATION_THRESHOLD: typeof ALERT_EVALUATION_THRESHOLD_TYPED = ALERT_EVALUATION_THRESHOLD_NON_TYPED;
const ALERT_EVALUATION_VALUE: typeof ALERT_EVALUATION_VALUE_TYPED = ALERT_EVALUATION_VALUE_NON_TYPED;
const ALERT_SEVERITY_LEVEL: typeof ALERT_SEVERITY_LEVEL_TYPED = ALERT_SEVERITY_LEVEL_NON_TYPED;
const ALERT_UUID: typeof ALERT_UUID_TYPED = ALERT_UUID_NON_TYPED;
const ALERT_RULE_CATEGORY: typeof ALERT_RULE_CATEGORY_TYPED = ALERT_RULE_CATEGORY_NON_TYPED;
const ALERT_RULE_NAME: typeof ALERT_RULE_NAME_TYPED = ALERT_RULE_NAME_NON_TYPED;

export function AlertsFlyout({
  alert,
  alerts,
  isInApp = false,
  observabilityRuleTypeRegistry,
  onClose,
  selectedAlertId,
}: AlertsFlyoutProps) {
  const dateFormat = useUiSetting<string>('dateFormat');
  const { services } = useKibana();
  const { http } = services;
  const prepend = http?.basePath.prepend;
  const decoratedAlerts = useMemo(() => {
    return decorateResponse(alerts ?? [], observabilityRuleTypeRegistry);
  }, [alerts, observabilityRuleTypeRegistry]);

  let alertData = alert;
  if (!alertData) {
    alertData = decoratedAlerts?.find((a) => a.fields[ALERT_UUID] === selectedAlertId);
  }
  if (!alertData) {
    return null;
  }

  const overviewListItems = [
    {
      title: i18n.translate('xpack.observability.alertsFlyout.statusLabel', {
        defaultMessage: 'Status',
      }),
      description: alertData.active ? 'Active' : 'Recovered',
    },
    {
      title: i18n.translate('xpack.observability.alertsFlyout.severityLabel', {
        defaultMessage: 'Severity',
      }),
      description: <SeverityBadge severityLevel={alertData.fields[ALERT_SEVERITY_LEVEL]} />,
    },
    {
      title: i18n.translate('xpack.observability.alertsFlyout.triggeredLabel', {
        defaultMessage: 'Triggered',
      }),
      description: (
        <span title={alertData.start.toString()}>{moment(alertData.start).format(dateFormat)}</span>
      ),
    },
    {
      title: i18n.translate('xpack.observability.alertsFlyout.durationLabel', {
        defaultMessage: 'Duration',
      }),
      description: asDuration(alertData.fields[ALERT_DURATION], { extended: true }),
    },
    {
      title: i18n.translate('xpack.observability.alertsFlyout.expectedValueLabel', {
        defaultMessage: 'Expected value',
      }),
      description: alertData.fields[ALERT_EVALUATION_THRESHOLD] ?? '-',
    },
    {
      title: i18n.translate('xpack.observability.alertsFlyout.actualValueLabel', {
        defaultMessage: 'Actual value',
      }),
      description: alertData.fields[ALERT_EVALUATION_VALUE] ?? '-',
    },
    {
      title: i18n.translate('xpack.observability.alertsFlyout.ruleTypeLabel', {
        defaultMessage: 'Rule type',
      }),
      description: alertData.fields[ALERT_RULE_CATEGORY] ?? '-',
    },
  ];

  return (
    <EuiFlyout onClose={onClose} size="s">
      <EuiFlyoutHeader>
        <EuiTitle size="m">
          <h2>{alertData.fields[ALERT_RULE_NAME]}</h2>
        </EuiTitle>
        <EuiSpacer size="s" />
        <EuiText size="s">{alertData.reason}</EuiText>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiSpacer size="s" />
        <EuiDescriptionList
          compressed={true}
          type="responsiveColumn"
          listItems={overviewListItems}
        />
      </EuiFlyoutBody>
      {alertData.link && !isInApp && (
        <EuiFlyoutFooter>
          <EuiFlexGroup justifyContent="flexEnd">
            <EuiFlexItem grow={false}>
              <EuiButton href={prepend && prepend(alertData.link)} fill>
                View in app
              </EuiButton>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlyoutFooter>
      )}
    </EuiFlyout>
  );
}

// eslint-disable-next-line import/no-default-export
export default AlertsFlyout;
