import type { Html, HtmlBuilder } from 'foldkit/html'

import type { Message } from '../message'

export const screenFrame = (
  children: ReadonlyArray<Html>,
  h: HtmlBuilder<Message>,
  modifier = '',
): Html =>
  h.div(
    [h.Class('app screen')],
    [
      h.header(
        [h.Class('topbar')],
        [
          h.div(
            [h.Class('brand')],
            [
              h.span([h.Class('brand-mark'), h.AriaHidden(true)]),
              h.h1([h.Class('brand-name')], ['All Aboard']),
              h.span([h.Class('brand-mark is-end'), h.AriaHidden(true)]),
            ],
          ),
        ],
      ),
      h.main([h.Class(`screen-body ${modifier}`.trim())], children),
    ],
  )
