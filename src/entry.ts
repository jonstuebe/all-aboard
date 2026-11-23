import { Runtime } from 'foldkit'

import {
  Flags,
  Message,
  Model,
  flags,
  init,
  managedResources,
  subscriptions,
  update,
  view,
} from './main'
import { enableMapZoom } from './mapZoom'
import { guardPinchZoom } from './pinchGuard'
import { trackScrollFades } from './scrollFade'

const application = Runtime.makeApplication({
  Model,
  Flags,
  init,
  update,
  view,
  subscriptions,
  managedResources,
  routing: {
    onUrlRequest: request => Message.ClickedLink({ request }),
    onUrlChange: url => Message.ChangedUrl({ url }),
  },
  container: document.getElementById('root'),
  devTools: {
    Message,
  },
})

guardPinchZoom()
enableMapZoom()
trackScrollFades()

Runtime.run(application, { flags })
