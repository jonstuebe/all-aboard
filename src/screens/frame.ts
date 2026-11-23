import type { Html, HtmlBuilder } from 'foldkit/html'

import type { Message } from '../message'

export const screenFrame = (
  children: ReadonlyArray<Html>,
  h: HtmlBuilder<Message>,
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
              h.span([h.Class('rivet'), h.AriaHidden(true)]),
              h.h1([h.Class('brand-name')], ['All Aboard']),
              h.span([h.Class('rivet'), h.AriaHidden(true)]),
            ],
          ),
        ],
      ),
      h.main([h.Class('screen-body')], children),
    ],
  )
