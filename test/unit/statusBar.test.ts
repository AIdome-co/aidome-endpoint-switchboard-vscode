/**
 * Unit tests for src/ui/statusBar.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStatusBarItem = {
  text: '',
  tooltip: '',
  color: undefined as unknown,
  command: undefined as string | undefined,
  accessibilityInformation: undefined as unknown,
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('vscode', () => ({
  window: {
    createStatusBarItem: vi.fn(() => mockStatusBarItem),
  },
  StatusBarAlignment: { Right: 2 },
  ThemeColor: class ThemeColor {
    constructor(public id: string) {}
  },
}));

import {
  StatusBarManager,
  createStatusBarItem,
  updateStatusBar,
  hideStatusBar,
  disposeStatusBar,
} from '../../src/ui/statusBar';

beforeEach(() => {
  disposeStatusBar();
  Object.assign(mockStatusBarItem, {
    text: '',
    tooltip: '',
    color: undefined,
    command: undefined,
    accessibilityInformation: undefined,
  });
  mockStatusBarItem.show.mockClear();
  mockStatusBarItem.hide.mockClear();
  mockStatusBarItem.dispose.mockClear();
});

describe('StatusBarManager', () => {
  let manager: StatusBarManager;

  beforeEach(() => {
    manager = new StatusBarManager(mockStatusBarItem as any);
  });

  describe('setConfigured', () => {
    it('shows the item with profile name', () => {
      manager.setConfigured('Production');
      expect(mockStatusBarItem.text).toBe('$(shield) AIdome: Production');
      expect(mockStatusBarItem.tooltip).toContain('Production');
      expect(mockStatusBarItem.color).toBeUndefined();
      expect(mockStatusBarItem.show).toHaveBeenCalled();
    });
  });

  describe('setNotConfigured', () => {
    it('shows the item with warning', () => {
      manager.setNotConfigured();
      expect(mockStatusBarItem.text).toBe('$(warning) AIdome: Not configured');
      expect(mockStatusBarItem.color).toBeDefined();
      expect(mockStatusBarItem.show).toHaveBeenCalled();
    });
  });

  describe('setError', () => {
    it('shows error state with custom message', () => {
      manager.setError('Connection failed');
      expect(mockStatusBarItem.text).toBe('$(error) AIdome: Error');
      expect(mockStatusBarItem.tooltip).toContain('Connection failed');
      expect(mockStatusBarItem.show).toHaveBeenCalled();
    });

    it('shows error state without message', () => {
      manager.setError();
      expect(mockStatusBarItem.text).toBe('$(error) AIdome: Error');
      expect(mockStatusBarItem.tooltip).toContain('Verification failed');
      expect(mockStatusBarItem.show).toHaveBeenCalled();
    });
  });

  describe('setVerifying', () => {
    it('shows verifying state', () => {
      manager.setVerifying();
      expect(mockStatusBarItem.text).toBe('$(sync~spin) AIdome: Verifying...');
      expect(mockStatusBarItem.color).toBeUndefined();
      expect(mockStatusBarItem.show).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('disposes the underlying item', () => {
      manager.dispose();
      expect(mockStatusBarItem.dispose).toHaveBeenCalled();
    });
  });
});

describe('createStatusBarItem', () => {
  it('creates a status bar item with command', () => {
    const item = createStatusBarItem();
    expect(item).toBeDefined();
    expect(item.command).toBe('aidome-switchboard.statusBarAction');
  });

  it('returns the same item on subsequent calls', () => {
    const item1 = createStatusBarItem();
    const item2 = createStatusBarItem();
    expect(item1).toBe(item2);
  });
});

describe('updateStatusBar', () => {
  it('shows configured state when profile provided', () => {
    updateStatusBar('TestProfile');
    expect(mockStatusBarItem.text).toBe('$(shield) AIdome: TestProfile');
    expect(mockStatusBarItem.show).toHaveBeenCalled();
  });

  it('shows not-configured state when no profile', () => {
    updateStatusBar();
    expect(mockStatusBarItem.text).toBe('$(warning) AIdome: Not configured');
    expect(mockStatusBarItem.show).toHaveBeenCalled();
  });
});

describe('hideStatusBar', () => {
  it('hides the status bar item', () => {
    createStatusBarItem(); // ensure it's created
    hideStatusBar();
    expect(mockStatusBarItem.hide).toHaveBeenCalled();
  });
});

describe('disposeStatusBar', () => {
  it('disposes and clears the status bar item', () => {
    createStatusBarItem(); // ensure it's created
    disposeStatusBar();
    expect(mockStatusBarItem.dispose).toHaveBeenCalled();
  });
});
