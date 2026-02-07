/**
 * Wizard screen definitions and rendering.
 */

import * as vscode from 'vscode';

/**
 * Wizard screen interface.
 */
export interface WizardScreen {
  id: string;
  title: string;
  description: string;
  render: () => Promise<void>;
  validate: () => Promise<boolean>;
}

/**
 * Shows the welcome screen.
 * @returns Promise resolving when complete
 */
export async function showWelcomeScreen(): Promise<void> {
  // Skeleton implementation
  throw new Error('Not implemented');
}

/**
 * Shows the assistant selection screen.
 * @returns Promise resolving to selected assistant keys
 */
export async function showAssistantSelectionScreen(): Promise<string[]> {
  // Skeleton implementation
  throw new Error('Not implemented');
}

/**
 * Shows the profile configuration screen.
 * @returns Promise resolving when complete
 */
export async function showProfileConfigScreen(): Promise<void> {
  // Skeleton implementation
  throw new Error('Not implemented');
}

/**
 * Shows the confirmation screen.
 * @returns Promise resolving to user confirmation
 */
export async function showConfirmationScreen(): Promise<boolean> {
  // Skeleton implementation
  throw new Error('Not implemented');
}
