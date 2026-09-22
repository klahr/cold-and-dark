import { el } from './dom';
import { KID_WELCOME } from './swedish';

/** How long the card takes to fade once it has been sent away. */
const LEAVE_MS = 300;

/**
 * The card that opens the trainer.
 *
 * A child who sits down in front of this sees a dark cockpit full of
 * switches and no indication of what any of it is for. The step card answers
 * "what do I do next", which is a question you can only have once you know
 * what you are doing at all — so this one comes first and answers that, in
 * three lines and a button.
 *
 * It is a screen rather than a paragraph on the step card because it is read
 * once and then never again. Put in the card, those three lines would be in
 * the way of every step for the rest of the session.
 */
export class Welcome {
  readonly element: HTMLElement;

  private readonly button: HTMLButtonElement;
  private readonly onDone: () => void;
  private gone = false;

  constructor(onDone: () => void) {
    this.onDone = onDone;

    this.element = el('div', 'kid-welcome');
    const card = el('section', 'kid-welcome-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', TITLE_ID);

    card.append(el('span', 'kid-welcome-plane', '✈️'));

    const title = el('h1', 'kid-welcome-title', KID_WELCOME.title);
    title.id = TITLE_ID;
    card.append(title);

    card.append(el('p', 'kid-welcome-lead', KID_WELCOME.lead));

    const steps = el('ul', 'kid-welcome-steps');
    for (const step of KID_WELCOME.steps) {
      const row = el('li', 'kid-welcome-step');
      // The glyph is decoration: it repeats what the line beside it says, so
      // a screen reader announcing "eyes emoji" before every row is noise.
      const icon = el('span', 'kid-welcome-icon', step.icon);
      icon.setAttribute('aria-hidden', 'true');
      row.append(icon, el('span', undefined, step.text));
      steps.append(row);
    }
    card.append(steps);

    this.button = el('button', 'kid-welcome-go', KID_WELCOME.button);
    this.button.type = 'button';
    this.button.addEventListener('click', () => this.dismiss());
    card.append(this.button);

    this.element.append(card);
  }

  /**
   * Gives the button the keyboard. There is one thing to do on this screen,
   * so the Enter key should do it without anybody having to find it first.
   */
  focus(): void {
    this.button.focus();
  }

  dismiss(): void {
    if (this.gone) return;
    this.gone = true;
    this.element.classList.add('leaving');
    // On a timer rather than on `transitionend`, which never fires if the
    // transition is cut short or turned off — and a card left behind is an
    // invisible sheet across the whole cockpit.
    window.setTimeout(() => this.element.remove(), LEAVE_MS);
    this.onDone();
  }
}

const TITLE_ID = 'kid-welcome-title';
