/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { formatMitreAttackDescription } from '../../helpers/rules';
import {
  getIndexPatterns,
  getNewRule,
  getNewThresholdRule,
  ThresholdRule,
} from '../../objects/rule';

import {
  ALERT_RULE_NAME,
  ALERT_RULE_RISK_SCORE,
  ALERT_RULE_SEVERITY,
  NUMBER_OF_ALERTS,
} from '../../screens/alerts';

import {
  CUSTOM_RULES_BTN,
  RISK_SCORE,
  RULE_NAME,
  RULE_SWITCH,
  RULES_ROW,
  RULES_TABLE,
  SEVERITY,
} from '../../screens/alerts_detection_rules';
import { PREVIEW_HEADER_SUBTITLE } from '../../screens/create_new_rule';
import {
  ABOUT_DETAILS,
  ABOUT_INVESTIGATION_NOTES,
  ABOUT_RULE_DESCRIPTION,
  ADDITIONAL_LOOK_BACK_DETAILS,
  CUSTOM_QUERY_DETAILS,
  FALSE_POSITIVES_DETAILS,
  DEFINITION_DETAILS,
  getDetails,
  removeExternalLinkText,
  INDEX_PATTERNS_DETAILS,
  INVESTIGATION_NOTES_MARKDOWN,
  INVESTIGATION_NOTES_TOGGLE,
  MITRE_ATTACK_DETAILS,
  REFERENCE_URLS_DETAILS,
  RISK_SCORE_DETAILS,
  RULE_NAME_HEADER,
  RULE_TYPE_DETAILS,
  RUNS_EVERY_DETAILS,
  SCHEDULE_DETAILS,
  SEVERITY_DETAILS,
  TAGS_DETAILS,
  THRESHOLD_DETAILS,
  TIMELINE_TEMPLATE_DETAILS,
} from '../../screens/rule_details';

import {
  goToManageAlertsDetectionRules,
  waitForAlertsIndexToBeCreated,
  waitForAlertsPanelToBeLoaded,
} from '../../tasks/alerts';
import {
  changeRowsPerPageTo100,
  filterByCustomRules,
  goToCreateNewRule,
  goToRuleDetails,
  waitForRulesTableToBeLoaded,
} from '../../tasks/alerts_detection_rules';
import { createCustomRuleActivated } from '../../tasks/api_calls/rules';
import { createTimeline } from '../../tasks/api_calls/timelines';
import { cleanKibana } from '../../tasks/common';
import {
  createAndActivateRule,
  fillAboutRuleAndContinue,
  fillDefineThresholdRuleAndContinue,
  fillDefineThresholdRule,
  fillScheduleRuleAndContinue,
  previewResults,
  selectThresholdRuleType,
  waitForAlertsToPopulate,
  waitForTheRuleToBeExecuted,
} from '../../tasks/create_new_rule';
import { loginAndWaitForPageWithoutDateRange } from '../../tasks/login';

import { ALERTS_URL } from '../../urls/navigation';

describe('Detection rules, threshold', () => {
  let rule = getNewThresholdRule();
  const expectedUrls = getNewThresholdRule().referenceUrls.join('');
  const expectedFalsePositives = getNewThresholdRule().falsePositivesExamples.join('');
  const expectedTags = getNewThresholdRule().tags.join('');
  const expectedMitre = formatMitreAttackDescription(getNewThresholdRule().mitre);

  beforeEach(() => {
    rule = getNewThresholdRule();
    cleanKibana();
    createTimeline(getNewThresholdRule().timeline).then((response) => {
      rule.timeline.id = response.body.data.persistTimeline.timeline.savedObjectId;
    });
    loginAndWaitForPageWithoutDateRange(ALERTS_URL);
    waitForAlertsPanelToBeLoaded();
    waitForAlertsIndexToBeCreated();
  });

  it('Creates and activates a new threshold rule', () => {
    goToManageAlertsDetectionRules();
    waitForRulesTableToBeLoaded();
    goToCreateNewRule();
    selectThresholdRuleType();
    fillDefineThresholdRuleAndContinue(rule);
    fillAboutRuleAndContinue(rule);
    fillScheduleRuleAndContinue(rule);
    createAndActivateRule();

    cy.get(CUSTOM_RULES_BTN).should('have.text', 'Custom rules (1)');

    changeRowsPerPageTo100();

    const expectedNumberOfRules = 1;
    cy.get(RULES_TABLE).then(($table) => {
      cy.wrap($table.find(RULES_ROW).length).should('eql', expectedNumberOfRules);
    });

    filterByCustomRules();

    cy.get(RULES_TABLE).then(($table) => {
      cy.wrap($table.find(RULES_ROW).length).should('eql', 1);
    });
    cy.get(RULE_NAME).should('have.text', rule.name);
    cy.get(RISK_SCORE).should('have.text', rule.riskScore);
    cy.get(SEVERITY).should('have.text', rule.severity);
    cy.get(RULE_SWITCH).should('have.attr', 'aria-checked', 'true');

    goToRuleDetails();

    cy.get(RULE_NAME_HEADER).should('contain', `${rule.name}`);
    cy.get(ABOUT_RULE_DESCRIPTION).should('have.text', rule.description);
    cy.get(ABOUT_DETAILS).within(() => {
      getDetails(SEVERITY_DETAILS).should('have.text', rule.severity);
      getDetails(RISK_SCORE_DETAILS).should('have.text', rule.riskScore);
      getDetails(REFERENCE_URLS_DETAILS).should((details) => {
        expect(removeExternalLinkText(details.text())).equal(expectedUrls);
      });
      getDetails(FALSE_POSITIVES_DETAILS).should('have.text', expectedFalsePositives);
      getDetails(MITRE_ATTACK_DETAILS).should((mitre) => {
        expect(removeExternalLinkText(mitre.text())).equal(expectedMitre);
      });
      getDetails(TAGS_DETAILS).should('have.text', expectedTags);
    });
    cy.get(INVESTIGATION_NOTES_TOGGLE).click({ force: true });
    cy.get(ABOUT_INVESTIGATION_NOTES).should('have.text', INVESTIGATION_NOTES_MARKDOWN);
    cy.get(DEFINITION_DETAILS).within(() => {
      getDetails(INDEX_PATTERNS_DETAILS).should('have.text', getIndexPatterns().join(''));
      getDetails(CUSTOM_QUERY_DETAILS).should('have.text', rule.customQuery);
      getDetails(RULE_TYPE_DETAILS).should('have.text', 'Threshold');
      getDetails(TIMELINE_TEMPLATE_DETAILS).should('have.text', 'None');
      getDetails(THRESHOLD_DETAILS).should(
        'have.text',
        `Results aggregated by ${rule.thresholdField} >= ${rule.threshold}`
      );
    });
    cy.get(SCHEDULE_DETAILS).within(() => {
      getDetails(RUNS_EVERY_DETAILS).should(
        'have.text',
        `${rule.runsEvery.interval}${rule.runsEvery.type}`
      );
      getDetails(ADDITIONAL_LOOK_BACK_DETAILS).should(
        'have.text',
        `${rule.lookBack.interval}${rule.lookBack.type}`
      );
    });

    waitForTheRuleToBeExecuted();
    waitForAlertsToPopulate();

    cy.get(NUMBER_OF_ALERTS).should(($count) => expect(+$count.text()).to.be.lt(100));
    cy.get(ALERT_RULE_NAME).first().should('have.text', rule.name);
    cy.get(ALERT_RULE_SEVERITY).first().should('have.text', rule.severity.toLowerCase());
    cy.get(ALERT_RULE_RISK_SCORE).first().should('have.text', rule.riskScore);
  });

  it('Preview results of keyword using "host.name"', () => {
    rule.index = [...rule.index, '.siem-signals*'];

    createCustomRuleActivated(getNewRule());
    goToManageAlertsDetectionRules();
    waitForRulesTableToBeLoaded();
    goToCreateNewRule();
    selectThresholdRuleType();
    fillDefineThresholdRule(rule);
    previewResults();

    cy.get(PREVIEW_HEADER_SUBTITLE).should('have.text', '3 unique hits');
  });

  it('Preview results of "ip" using "source.ip"', () => {
    const previewRule: ThresholdRule = {
      ...rule,
      thresholdField: 'source.ip',
      threshold: '1',
    };
    previewRule.index = [...previewRule.index, '.siem-signals*'];

    createCustomRuleActivated(getNewRule());
    goToManageAlertsDetectionRules();
    waitForRulesTableToBeLoaded();
    goToCreateNewRule();
    selectThresholdRuleType();
    fillDefineThresholdRule(previewRule);
    previewResults();

    cy.get(PREVIEW_HEADER_SUBTITLE).should('have.text', '10 unique hits');
  });
});
