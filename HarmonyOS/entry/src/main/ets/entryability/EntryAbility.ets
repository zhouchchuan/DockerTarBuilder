import UIAbility from '@ohos.app.ability.UIAbility';
import window from '@ohos.window';

export default class EntryAbility extends UIAbility {
  onForeground(): void { AppStorage.setOrCreate('wuaiForeground', true); }
  onBackground(): void { AppStorage.setOrCreate('wuaiForeground', false); }
  onWindowStageCreate(stage: window.WindowStage): void {
    const main = stage.getMainWindowSync();
    main.setWindowSystemBarEnable(['navigation']).catch(() => {});
    main.setPreferredOrientation(window.Orientation.PORTRAIT).catch(() => {});
    stage.loadContent('pages/Index');
  }
}
