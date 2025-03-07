/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */
import type { estypes } from '@elastic/elasticsearch';
import { map, reduce, mapValues, has, get, keys, pickBy } from 'lodash';
import type { FieldFilter, Filter, FilterMeta } from './types';
import type { IndexPatternBase, IndexPatternFieldBase } from '../../es_query';

const OPERANDS_IN_RANGE = 2;

const operators = {
  gt: '>',
  gte: '>=',
  lte: '<=',
  lt: '<',
};
const comparators = {
  gt: 'boolean gt(Supplier s, def v) {return s.get() > v}',
  gte: 'boolean gte(Supplier s, def v) {return s.get() >= v}',
  lte: 'boolean lte(Supplier s, def v) {return s.get() <= v}',
  lt: 'boolean lt(Supplier s, def v) {return s.get() < v}',
};

const dateComparators = {
  gt: 'boolean gt(Supplier s, def v) {return s.get().toInstant().isAfter(Instant.parse(v))}',
  gte: 'boolean gte(Supplier s, def v) {return !s.get().toInstant().isBefore(Instant.parse(v))}',
  lte: 'boolean lte(Supplier s, def v) {return !s.get().toInstant().isAfter(Instant.parse(v))}',
  lt: 'boolean lt(Supplier s, def v) {return s.get().toInstant().isBefore(Instant.parse(v))}',
};

/**
 * An interface for all possible range filter params
 * @public
 */
export interface RangeFilterParams {
  from?: number | string;
  to?: number | string;
  gt?: number | string;
  lt?: number | string;
  gte?: number | string;
  lte?: number | string;
  format?: string;
}

const hasRangeKeys = (params: RangeFilterParams) =>
  Boolean(
    keys(params).find((key: string) => ['gte', 'gt', 'lte', 'lt', 'from', 'to'].includes(key))
  );

export type RangeFilterMeta = FilterMeta & {
  params: RangeFilterParams;
  field?: string;
  formattedValue?: string;
};

export interface EsRangeFilter {
  range: { [key: string]: RangeFilterParams };
}

/**
 * @public
 */
export type RangeFilter = Filter &
  EsRangeFilter & {
    meta: RangeFilterMeta;
    script?: {
      script: {
        params: any;
        lang: estypes.ScriptLanguage;
        source: string;
      };
    };
    match_all?: any;
  };

/**
 * @param filter
 * @returns `true` if a filter is an `RangeFilter`
 *
 * @public
 */
export const isRangeFilter = (filter?: FieldFilter): filter is RangeFilter => has(filter, 'range');

/**
 *
 * @param filter
 * @returns `true` if a filter is a scripted `RangeFilter`
 *
 * @public
 */
export const isScriptedRangeFilter = (filter: FieldFilter): filter is RangeFilter => {
  const params: RangeFilterParams = get(filter, 'script.script.params', {});

  return hasRangeKeys(params);
};

/**
 * @internal
 */
export const getRangeFilterField = (filter: RangeFilter) => {
  return filter.range && Object.keys(filter.range)[0];
};

const formatValue = (params: any[]) =>
  map(params, (val: any, key: string) => get(operators, key) + val).join(' ');

/**
 * Creates a filter where the value for the given field is in the given range
 * params should be an object containing `lt`, `lte`, `gt`, and/or `gte`
 *
 * @param field
 * @param params
 * @param indexPattern
 * @param formattedValue
 * @returns
 *
 * @public
 */
export const buildRangeFilter = (
  field: IndexPatternFieldBase,
  params: RangeFilterParams,
  indexPattern: IndexPatternBase,
  formattedValue?: string
): RangeFilter => {
  const filter: any = { meta: { index: indexPattern.id, params: {} } };

  if (formattedValue) {
    filter.meta.formattedValue = formattedValue;
  }

  params = mapValues(params, (value: any) => (field.type === 'number' ? parseFloat(value) : value));

  if ('gte' in params && 'gt' in params) throw new Error('gte and gt are mutually exclusive');
  if ('lte' in params && 'lt' in params) throw new Error('lte and lt are mutually exclusive');

  const totalInfinite = ['gt', 'lt'].reduce((acc: number, op: any) => {
    const key = op in params ? op : `${op}e`;
    const isInfinite = Math.abs(get(params, key)) === Infinity;

    if (isInfinite) {
      acc++;

      // @ts-ignore
      delete params[key];
    }

    return acc;
  }, 0);

  if (totalInfinite === OPERANDS_IN_RANGE) {
    filter.match_all = {};
    filter.meta.field = field.name;
  } else if (field.scripted) {
    filter.script = getRangeScript(field, params);
    filter.script.script.params.value = formatValue(filter.script.script.params);

    filter.meta.field = field.name;
  } else {
    filter.range = {};
    filter.range[field.name] = params;
  }

  return filter as RangeFilter;
};

/**
 * @internal
 */
export const getRangeScript = (field: IndexPatternFieldBase, params: RangeFilterParams) => {
  const knownParams = mapValues(
    pickBy(params, (val, key: any) => key in operators),
    (value) => (field.type === 'number' && typeof value === 'string' ? parseFloat(value) : value)
  );
  let script = map(
    knownParams,
    (val: any, key: string) => '(' + field.script + ')' + get(operators, key) + key
  ).join(' && ');

  // We must wrap painless scripts in a lambda in case they're more than a simple expression
  if (field.lang === 'painless') {
    const comp = field.type === 'date' ? dateComparators : comparators;
    const currentComparators = reduce(
      knownParams,
      (acc, val, key) => acc.concat(get(comp, key)),
      []
    ).join(' ');

    const comparisons = map(
      knownParams,
      (val, key) => `${key}(() -> { ${field.script} }, params.${key})`
    ).join(' && ');

    script = `${currentComparators}${comparisons}`;
  }

  return {
    script: {
      source: script,
      params: knownParams,
      lang: field.lang,
    },
  };
};
