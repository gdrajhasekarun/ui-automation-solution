import type { Page } from 'playwright'
import type { UILibrary, ElementType } from '../../types.js'
import { materialInteractors }  from './material.js'
import { ionicInteractors }     from './ionic.js'
import { antdInteractors }      from './antd.js'
import { chakraInteractors }    from './chakra.js'
import { vuetifyInteractors }   from './vuetify.js'
import { shadcnInteractors }    from './shadcn.js'
import { bootstrapInteractors } from './bootstrap.js'
import { baseInteractors }      from './base.js'

export interface LibFieldInteractor {
  fill?(page: Page, selector: string, value: string): Promise<void>
  click?(page: Page, selector: string): Promise<void>
  getOptions?(page: Page, selector: string): Promise<string[]>
  isVisible?(page: Page, selector: string): Promise<boolean>
}

export type LibInteractorMap = Partial<Record<ElementType, LibFieldInteractor>>

const LIB_MAP: Record<UILibrary, LibInteractorMap> = {
  material:  materialInteractors,
  ionic:     ionicInteractors,
  antd:      antdInteractors,
  chakra:    chakraInteractors,
  vuetify:   vuetifyInteractors,
  shadcn:    shadcnInteractors,
  bootstrap: bootstrapInteractors,
  tailwind:  baseInteractors,
  unknown:   baseInteractors,
}

export function getLibInteractor(library: UILibrary, elementType: ElementType): LibFieldInteractor | null {
  return LIB_MAP[library]?.[elementType] ?? null
}
