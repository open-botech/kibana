/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import React, { Fragment, useContext, useState } from 'react';

import {
  EuiBasicTable,
  EuiButton,
  EuiCodeEditor,
  EuiDescribedFormGroup,
  EuiFieldNumber,
  EuiFlexGroup,
  EuiFlexItem,
  EuiForm,
  EuiFormRow,
  EuiLink,
  EuiSelect,
  EuiSpacer,
  EuiSwitch,
  EuiText,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { FormattedMessage } from '@kbn/i18n/react';
import { ExecuteDetails } from 'plugins/watcher/models/execute_details/execute_details';
import { WatchHistoryItem } from 'plugins/watcher/models/watch_history_item';
import { ACTION_MODES, TIME_UNITS } from '../../../../../common/constants';
import {
  ExecutedWatchDetails,
  ExecutedWatchResults,
} from '../../../../../common/types/watch_types';
import { ErrableFormRow } from '../../../../components/form_errors';
import { executeWatch } from '../../../../lib/api';
import { executeWatchApiUrl } from '../../../../lib/documentation_links';
import { WatchContext } from '../../watch_context';
import { JsonWatchEditSimulateResults } from './json_watch_edit_simulate_results';
import { getTimeUnitLabel } from '../../../../lib/get_time_unit_label';

const actionModeOptions = Object.keys(ACTION_MODES).map(mode => ({
  text: ACTION_MODES[mode],
  value: ACTION_MODES[mode],
}));

const getScheduleTimeOptions = (unitSize = '0') =>
  Object.entries(TIME_UNITS)
    .filter(([key]) => key !== TIME_UNITS.DAY)
    .map(([_key, value]) => {
      return {
        text: getTimeUnitLabel(value, unitSize),
        value,
      };
    });

export const JsonWatchEditSimulate = ({
  executeWatchErrors,
  hasExecuteWatchErrors,
  executeDetails,
  setExecuteDetails,
  watchActions,
}: {
  executeWatchErrors: { [key: string]: string[] };
  hasExecuteWatchErrors: boolean;
  executeDetails: ExecutedWatchDetails;
  setExecuteDetails: (details: ExecutedWatchDetails) => void;
  watchActions: Array<{
    actionId: string;
    actionMode: string;
    type: string;
  }>;
}) => {
  const { watch } = useContext(WatchContext);

  // hooks
  const [executeResults, setExecuteResults] = useState<ExecutedWatchResults | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executeResultsError, setExecuteResultsError] = useState<any>(null);

  const { errors: watchErrors } = watch.validate();
  const hasWatchJsonError = watchErrors.json.length >= 1;

  const {
    actionModes,
    scheduledTimeValue,
    scheduledTimeUnit,
    triggeredTimeValue,
    alternativeInput,
    ignoreCondition,
  } = executeDetails;

  const columns = [
    {
      field: 'actionId',
      name: i18n.translate('xpack.watcher.sections.watchEdit.simulate.table.idColumnLabel', {
        defaultMessage: 'ID',
      }),
      sortable: true,
      truncateText: true,
    },
    {
      field: 'type',
      name: i18n.translate('xpack.watcher.sections.watchEdit.simulate.table.typeColumnLabel', {
        defaultMessage: '类型',
      }),
      truncateText: true,
    },
    {
      field: 'actionMode',
      name: i18n.translate('xpack.watcher.sections.watchEdit.simulate.table.modeColumnLabel', {
        defaultMessage: '模式',
      }),
      render: ({}, row: { actionId: string }) => (
        <EuiSelect
          options={actionModeOptions}
          value={actionModes[row.actionId]}
          data-test-subj="actionModesSelect"
          onChange={e => {
            setExecuteDetails(
              new ExecuteDetails({
                ...executeDetails,
                actionModes: { ...actionModes, [row.actionId]: e.target.value },
              })
            );
          }}
          aria-label={i18n.translate(
            'xpack.watcher.sections.watchEdit.simulate.table.modeSelectLabel',
            {
              defaultMessage: 'Action modes',
            }
          )}
        />
      ),
    },
  ];

  return (
    <Fragment>
      <JsonWatchEditSimulateResults
        executeResults={executeResults}
        executeDetails={executeDetails}
        error={executeResultsError}
        onCloseFlyout={() => {
          setExecuteResults(null);
          setExecuteResultsError(null);
        }}
      />
      <EuiText>
        <p>
          {i18n.translate('xpack.watcher.sections.watchEdit.simulate.pageDescription', {
            defaultMessage: '使用模拟器可覆盖监视计划、条件、操作和输入结果。',
          })}
        </p>
      </EuiText>
      <EuiSpacer size="l" />
      <EuiForm data-test-subj="jsonWatchSimulateForm">
        <EuiDescribedFormGroup
          fullWidth
          title={
            <h3>
              {i18n.translate(
                'xpack.watcher.sections.watchEdit.simulate.form.triggerOverridesTitle',
                { defaultMessage: '触发' }
              )}
            </h3>
          }
          description={i18n.translate(
            'xpack.watcher.sections.watchEdit.simulate.form.triggerOverridesDescription',
            {
              defaultMessage: '设置启动监控的时间和日期',
            }
          )}
        >
          <EuiFormRow
            label={i18n.translate(
              'xpack.watcher.sections.watchEdit.simulate.form.scheduledTimeFieldLabel',
              {
                defaultMessage: '间隔时间',
              }
            )}
          >
            <EuiFlexGroup>
              <EuiFlexItem>
                <EuiFieldNumber
                  value={scheduledTimeValue}
                  min={0}
                  data-test-subj="scheduledTimeInput"
                  onChange={e => {
                    const value = e.target.value;
                    setExecuteDetails(
                      new ExecuteDetails({
                        ...executeDetails,
                        scheduledTimeValue: value === '' ? value : parseInt(value, 10),
                      })
                    );
                  }}
                />
              </EuiFlexItem>
              <EuiFlexItem>
                <EuiSelect
                  value={scheduledTimeUnit}
                  options={getScheduleTimeOptions(scheduledTimeValue)}
                  onChange={e => {
                    setExecuteDetails(
                      new ExecuteDetails({
                        ...executeDetails,
                        scheduledTimeUnit: e.target.value,
                      })
                    );
                  }}
                />
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFormRow>
          <EuiFormRow
            label={i18n.translate(
              'xpack.watcher.sections.watchEdit.simulate.form.triggeredTimeFieldLabel',
              {
                defaultMessage: '延迟触发',
              }
            )}
          >
            <EuiFieldNumber
              value={triggeredTimeValue}
              min={0}
              data-test-subj="triggeredTimeInput"
              append={
                <EuiText size="s">
                  {getTimeUnitLabel(TIME_UNITS.SECOND, triggeredTimeValue)}
                </EuiText>
              }
              onChange={e => {
                const value = e.target.value;
                setExecuteDetails(
                  new ExecuteDetails({
                    ...executeDetails,
                    triggeredTimeValue: value === '' ? value : parseInt(value, 10),
                    triggeredTimeUnit: TIME_UNITS.SECOND,
                  })
                );
              }}
            />
          </EuiFormRow>
        </EuiDescribedFormGroup>

        <EuiDescribedFormGroup
          fullWidth
          title={
            <h3>
              {i18n.translate(
                'xpack.watcher.sections.watchEdit.simulate.form.conditionOverridesTitle',
                { defaultMessage: '条件' }
              )}
            </h3>
          }
          description={i18n.translate(
            'xpack.watcher.sections.watchEdit.simulate.form.conditionOverridesDescription',
            {
              defaultMessage:
                '在满足该条件时，执行该监控。否则，请忽略该条件，并按固定的时间表运行监控。',
            }
          )}
        >
          <EuiSwitch
            label={i18n.translate(
              'xpack.watcher.sections.watchEdit.simulate.form.ignoreConditionFieldLabel',
              {
                defaultMessage: '忽略条件',
              }
            )}
            checked={ignoreCondition}
            data-test-subj="ignoreConditionSwitch"
            onChange={e => {
              setExecuteDetails(
                new ExecuteDetails({ ...executeDetails, ignoreCondition: e.target.checked })
              );
            }}
          />
        </EuiDescribedFormGroup>

        <EuiDescribedFormGroup
          fullWidth
          idAria="simulateExecutionActionModesDescription"
          title={
            <h3>
              {i18n.translate(
                'xpack.watcher.sections.watchEdit.simulate.form.actionOverridesTitle',
                { defaultMessage: '操作' }
              )}
            </h3>
          }
          description={
            <FormattedMessage
              id="xpack.watcher.sections.watchEdit.simulate.form.actionOverridesDescription"
              defaultMessage="允许监控程序执行或跳过操作. "
              values={{
                actionsLink: (
                  <EuiLink href={executeWatchApiUrl} target="_blank">
                    {i18n.translate(
                      'xpack.watcher.sections.watchEdit.simulate.form.actionOverridesDescription.linkLabel',
                      {
                        defaultMessage: 'Learn about actions.',
                      }
                    )}
                  </EuiLink>
                ),
              }}
            />
          }
        >
          <EuiFormRow
            间隔时间={['simulateExecutionActionModesDescription']}
            label={i18n.translate(
              'xpack.watcher.sections.watchEdit.simulate.form.actionModesFieldLabel',
              {
                defaultMessage: '操作模式',
              }
            )}
            fullWidth
          >
            <EuiBasicTable
              items={watchActions}
              itemId="simulateExecutionActionModesTable"
              columns={columns}
            />
          </EuiFormRow>
        </EuiDescribedFormGroup>

        <EuiDescribedFormGroup
          fullWidth
          idAria="simulateExecutionInputOverridesDescription"
          title={
            <h3>
              {i18n.translate(
                'xpack.watcher.sections.watchEdit.simulate.form.inputOverridesTitle',
                { defaultMessage: '输入' }
              )}
            </h3>
          }
          description={i18n.translate(
            'xpack.watcher.sections.watchEdit.simulate.form.inputOverridesDescription',
            {
              defaultMessage: '输入JSON数据以覆盖运行输入时产生的监控有效负载.',
            }
          )}
        >
          <ErrableFormRow
            id="executeWatchJson"
            describedByIds={['simulateExecutionInputOverridesDescription']}
            label={i18n.translate(
              'xpack.watcher.sections.watchEdit.simulate.form.alternativeInputFieldLabel',
              {
                defaultMessage: '替代输入',
              }
            )}
            errorKey="json"
            isShowingErrors={hasExecuteWatchErrors}
            fullWidth
            errors={executeWatchErrors}
          >
            <EuiCodeEditor
              fullWidth
              mode="json"
              width="100%"
              height="200px"
              theme="github"
              aria-label={i18n.translate(
                'xpack.watcher.sections.watchEdit.simulate.form.alternativeInputAriaLabel',
                {
                  defaultMessage: 'Code editor',
                }
              )}
              value={alternativeInput}
              onChange={(json: string) => {
                setExecuteDetails(
                  new ExecuteDetails({
                    ...executeDetails,
                    alternativeInput: json,
                  })
                );
              }}
            />
          </ErrableFormRow>
        </EuiDescribedFormGroup>
        <EuiButton
          iconType="play"
          data-test-subj="simulateWatchButton"
          fill
          type="submit"
          style={{ background: '#096dd9' }}
          isLoading={isExecuting}
          isDisabled={hasExecuteWatchErrors || hasWatchJsonError}
          onClick={async () => {
            setIsExecuting(true);

            const { data, error } = await executeWatch(executeDetails, watch);

            setIsExecuting(false);

            if (error) {
              return setExecuteResultsError(error);
            }

            const formattedResults = WatchHistoryItem.fromUpstreamJson(data.watchHistoryItem);
            setExecuteResults(formattedResults);
          }}
        >
          {i18n.translate('xpack.watcher.sections.watchEdit.simulate.form.saveButtonLabel', {
            defaultMessage: '模拟监控',
          })}
        </EuiButton>
      </EuiForm>
    </Fragment>
  );
};
