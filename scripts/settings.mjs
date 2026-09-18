/**
 * 模块设置：引擎总开关。设置改动立即生效（onChange），无需重载。
 */

import { MODULE_ID, SETTINGS } from "./const.mjs";

let engineEnabled = true;

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.ENABLED, {
    name: `${MODULE_ID}.Settings.EnabledName`,
    hint: `${MODULE_ID}.Settings.EnabledHint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: (value) => {
      engineEnabled = value !== false;
    },
  });

  engineEnabled = game.settings.get(MODULE_ID, SETTINGS.ENABLED) !== false;
}

export function isEngineEnabled() {
  return engineEnabled !== false;
}
