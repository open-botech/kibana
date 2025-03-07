/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import * as t from 'io-ts';
import { getFallbackToTransactions } from '../lib/helpers/aggregated_transactions/get_fallback_to_transactions';
import { setupRequest } from '../lib/helpers/setup_request';
import { createApmServerRoute } from './create_apm_server_route';
import { createApmServerRouteRepository } from './create_apm_server_route_repository';
import { kueryRt, rangeRt } from './default_api_types';

const fallbackToTransactionsRoute = createApmServerRoute({
  endpoint: 'GET /api/apm/fallback_to_transactions',
  params: t.partial({
    query: t.intersection([kueryRt, t.partial(rangeRt.props)]),
  }),
  options: { tags: ['access:apm'] },
  handler: async (resources) => {
    const setup = await setupRequest(resources);
    const {
      params: {
        query: { kuery },
      },
    } = resources;
    return {
      fallbackToTransactions: await getFallbackToTransactions({ setup, kuery }),
    };
  },
});

export const fallbackToTransactionsRouteRepository = createApmServerRouteRepository().add(
  fallbackToTransactionsRoute
);
