import * as qv from 'vscode';

let globalState: qv.Memento;
let workspaceState: qv.Memento;

export function getFromGlobalState(key: string, defaultValue?: any): any {
  if (!globalState) {
    return defaultValue;
  }
  return globalState.get(key, defaultValue);
}

export function updateGlobalState(key: string, value: any) {
  if (!globalState) {
    return;
  }
  return globalState.update(key, value);
}

export function setGlobalState(state: qv.Memento) {
  globalState = state;
}

export function getGlobalState() {
  return globalState;
}

export function resetGlobalState() {
  resetStateQuickPick(globalState, updateGlobalState);
}

export function getFromWorkspaceState(key: string, defaultValue?: any) {
  if (!workspaceState) {
    return defaultValue;
  }
  return workspaceState.get(key, defaultValue);
}

export function updateWorkspaceState(key: string, value: any) {
  if (!workspaceState) {
    return;
  }
  return workspaceState.update(key, value);
}

export function setWorkspaceState(state: qv.Memento) {
  workspaceState = state;
}

export function getWorkspaceState(): qv.Memento {
  return workspaceState;
}

export function resetWorkspaceState() {
  resetStateQuickPick(workspaceState, updateWorkspaceState);
}

export function getMementoKeys(state: qv.Memento): string[] {
  if (!state) {
    return [];
  }
  // tslint:disable-next-line: no-empty
  if ((state as any)._value) {
    const keys = Object.keys((state as any)._value);
    // Filter out keys with undefined values, so they are not shown
    // in the quick pick menu.
    return keys.filter((key) => state.get(key) !== undefined);
  }
  return [];
}

async function resetStateQuickPick(state: qv.Memento, updateFn: (key: string, value: any) => {}) {
  const items = await qv.window.showQuickPick(getMementoKeys(state), {
    canPickMany: true,
    placeHolder: 'Select the keys to reset.',
  });
  resetItemsState(items, updateFn);
}

export function resetItemsState(items: string[], updateFn: (key: string, value: any) => {}) {
  if (!items) {
    return;
  }
  items.forEach((item) => updateFn(item, undefined));
}
