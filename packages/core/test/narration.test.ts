import { describe, expect, it } from 'vitest';
import { narrates, readNarration, signsOff } from '../src/narration.js';

describe('copy that narrates the interface', () => {
  it('a sentence that explains the page to itself', () => {
    expect(narrates('Recent transactions', 'This page shows your recent transactions and their status.')).toBe(
      'self-reference',
    );
    expect(narrates('Budgets', 'Here you can set a monthly limit for each category.')).toBe('self-reference');
    expect(narrates('Reports', 'Use this section to export statements.')).toBe('self-reference');
    expect(narrates('Overview', 'The dashboard gives you a summary of every account.')).toBe('self-reference');
  });

  it('a sentence that only says the heading again', () => {
    expect(narrates('Recent activity', 'Your recent account activity.')).toBe('echo');
    expect(narrates('Monthly spending', 'See your monthly spending at a glance.')).toBe('echo');
  });

  // The negative set, written as GOV.UK service pages write: each says something the heading
  // does not, so none is narration.
  it.each([
    ['Apply for a passport', 'It costs £82.50 to apply online.'],
    ['Before you start', "You'll need your old passport and a digital photo."],
    ['Check your answers', 'Check your answers before sending your application.'],
    ['Recent activity', 'Payments made in the last 30 days.'],
    ['Your payments', 'Payments to Thames Water are taken on the 1st.'],
    ['Pricing', 'Free for teams of up to five people; then per seat.'],
    ['Settings', 'Changes are saved as soon as you make them.'],
    ['Contact us', 'Phone 0300 123 4567, Monday to Friday, 8am to 6pm.'],
    ['Budgets', 'This month you have spent less than you planned.'],
    ['Recent payments', 'Recent payments total £240 this week.'],
    ['Team members', 'Team members joined by Ada Lovelace.'],
  ])('%s / %s says something', (h, t) => {
    expect(narrates(h, t)).toBeNull();
  });

  it('a sign-off that vouches for the figures; never a legal notice', () => {
    expect(signsOff('Every figure here is derived from the ledger.')).toBe(true);
    expect(signsOff('All amounts are calculated in real time from your linked accounts.')).toBe(true);
    expect(signsOff('All amounts are in GBP. Capital at risk.')).toBe(false);
    expect(signsOff('All figures are calculated by the FCA register.')).toBe(false);
    expect(signsOff('Updated 3 minutes ago.')).toBe(false);
  });

  it('cards written each for itself are not a pattern', () => {
    const card = (h: string, t: string, i: number) => ({ sel: `li:nth-of-type(${i})`, heading: h, text: t, grid: 'g' });
    const r = readNarration(
      [
        card('Pay a bill', 'Send money to anyone with a sort code and account number.', 1),
        card('Freeze your card', 'Stop new payments at once if your card is lost or stolen.', 2),
        card('Get help', 'Talk to someone in the app, any time of day or night.', 3),
      ],
      [],
    );
    expect(r.uniformGrids).toEqual([]);
  });

  it('cards that each open the same way are a pattern; cards carrying data are not', () => {
    const card = (grid: string, h: string, t: string, i: number) => ({
      sel: `div.card:nth-of-type(${i})`,
      heading: h,
      text: t,
      grid,
    });
    const r = readNarration(
      [
        card('g1', 'Accounts', 'Easily manage all of your connected bank accounts in one simple place.', 1),
        card('g1', 'Budgets', 'Easily plan the money you want to spend each month by category.', 2),
        card('g1', 'Goals', 'Easily save towards the things that matter most to you and yours.', 3),
        card('g2', 'Current account', 'Balance £1,204.50, last payment to Tesco on 3 March.', 1),
        card('g2', 'Savings', 'Balance £8,000.00 earning 4.1% a year, paid monthly.', 2),
        card('g2', 'Credit card', 'Balance £312.10 due on 14 March, minimum £25.', 3),
      ],
      [],
    );
    expect(r.uniformGrids).toEqual([{ grid: 'g1', n: 3, sel: 'div.card:nth-of-type(1)', opening: 'easily' }]);
  });
});
