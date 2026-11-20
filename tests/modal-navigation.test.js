// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeUI } from './ui-helpers.js';

let ui, game;
beforeEach(() => {
  ({ ui } = makeUI());
  game = ui.game;
  ui.renderModal = vi.fn(); // navigation is under test here, not the board templates
});

describe('Pause menu navigation', () => {
  it.each(['settings', 'help', 'save'])('Pause -> %s -> close returns to Pause and stays paused', (child) => {
    ui.open('pause');
    expect(game.paused).toBe(true);
    ui.open(child);
    expect(ui.modal).toBe(child);
    expect(game.paused).toBe(true); // opening a child does not resume the game
    ui.closeModal();
    expect(ui.modal).toBe('pause'); // back to the parent, not to gameplay
    expect(game.paused).toBe(true);
    expect(document.getElementById('modal').classList.contains('hidden')).toBe(false);
  });

  it('closing Pause itself resumes gameplay and unblocks the HUD', () => {
    ui.open('pause'); ui.open('settings'); ui.closeModal();
    ui.closeModal();
    expect(ui.modal).toBeNull();
    expect(game.paused).toBe(false);
    expect(document.getElementById('hud').inert).toBe(false);
    expect(document.getElementById('modal').classList.contains('hidden')).toBe(true);
  });

  it('Escape-style toggling: togglePause opens Pause and closes it again', () => {
    ui.togglePause(); expect(ui.modal).toBe('pause'); expect(game.paused).toBe(true);
    ui.open('help'); ui.closeModal(); expect(ui.modal).toBe('pause');
    ui.togglePause(); expect(ui.modal).toBeNull(); expect(game.paused).toBe(false);
  });

  it('a child opened from another child (Pause -> Settings -> Statistics) still returns to Pause', () => {
    ui.open('pause'); ui.open('settings'); ui.open('stats');
    expect(game.paused).toBe(true);
    ui.closeModal();
    expect(ui.modal).toBe('pause');
    expect(game.paused).toBe(true);
  });

  it('every child of Pause blocks the HUD behind it while paused', () => {
    ui.open('pause'); ui.open('save');
    expect(document.getElementById('hud').inert).toBe(true);
  });
});

describe('modals opened from active gameplay', () => {
  it('a normal board (Staff) does not pause the game and closing it returns to gameplay', () => {
    ui.open('staff');
    expect(game.paused).toBe(false);
    ui.closeModal();
    expect(ui.modal).toBeNull(); expect(game.paused).toBe(false);
  });

  it('Settings opened from the More menu (not from Pause) closes straight back to gameplay', () => {
    ui.open('settings');
    expect(game.paused).toBe(false);
    ui.closeModal();
    expect(ui.modal).toBeNull(); expect(game.paused).toBe(false);
  });

  it('opening Pause from a board replaces the board; closing Pause then resumes', () => {
    ui.open('staff'); ui.open('pause');
    expect(ui.modal).toBe('pause'); expect(game.paused).toBe(true);
    ui.closeModal();
    expect(ui.modal).toBeNull(); expect(game.paused).toBe(false);
  });

  it('a stale parent never leaks: Pause -> Settings -> (Pause closed) -> Staff -> close does not return to Pause', () => {
    ui.open('pause'); ui.open('settings'); ui.closeModal(); ui.closeModal(); // back at gameplay
    ui.open('staff');
    ui.closeModal();
    expect(ui.modal).toBeNull();
    expect(game.paused).toBe(false);
  });

  it('closeModal with nothing open is harmless', () => {
    expect(() => { ui.closeModal(); ui.closeModal(); }).not.toThrow();
    expect(game.paused).toBe(false);
  });

  it('opening a board while a confirm dialog is open cancels the dialog first', () => {
    ui.open('staff');
    let answer = 'pending';
    ui.askConfirm({ title: 'x', text: 'y' }).then((v) => { answer = v; });
    ui.open('finance');
    return Promise.resolve().then(() => { expect(answer).toBe(false); expect(ui.confirmOpen).toBeFalsy(); expect(ui.modal).toBe('finance'); });
  });
});
