/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EmbeddableRegistryDefinition } from 'src/plugins/embeddable/server';
import type { SerializableRecord } from '@kbn/utility-types';
import { DOC_TYPE } from '../../common';
import {
  commonRemoveTimezoneDateHistogramParam,
  commonRenameOperationsForFormula,
  commonUpdateVisLayerType,
} from '../migrations/common_migrations';
import {
  LensDocShape713,
  LensDocShape715,
  LensDocShapePre712,
  VisStatePre715,
} from '../migrations/types';

export const lensEmbeddableFactory = (): EmbeddableRegistryDefinition => {
  return {
    id: DOC_TYPE,
    migrations: {
      // This migration is run in 7.13.1 for `by value` panels because the 7.13 release window was missed.
      '7.13.1': (state) => {
        const lensState = (state as unknown) as { attributes: LensDocShapePre712 };
        const migratedLensState = commonRenameOperationsForFormula(lensState.attributes);
        return ({
          ...lensState,
          attributes: migratedLensState,
        } as unknown) as SerializableRecord;
      },
      '7.14.0': (state) => {
        const lensState = (state as unknown) as { attributes: LensDocShape713 };
        const migratedLensState = commonRemoveTimezoneDateHistogramParam(lensState.attributes);
        return ({
          ...lensState,
          attributes: migratedLensState,
        } as unknown) as SerializableRecord;
      },
      '7.15.0': (state) => {
        const lensState = (state as unknown) as { attributes: LensDocShape715<VisStatePre715> };
        const migratedLensState = commonUpdateVisLayerType(lensState.attributes);
        return ({
          ...lensState,
          attributes: migratedLensState,
        } as unknown) as SerializableRecord;
      },
    },
  };
};
