import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FinderScreen } from './FinderScreen.js';

const COMPLETE_DIAGNOSTIC = {
  objectType: 'cultural-heritage',
  currentStage: 'concept',
  desiredResult: 'project-documentation',
  expertiseRequired: 'yes',
  culturalHeritageSite: 'yes',
  scope: { kind: 'portfolio', objectCount: 4 },
} as const;

afterEach(cleanup);

describe('FinderScreen', () => {
  it('runs the local diagnostic and returns typed recommendations to the brief flow', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const onDiscuss = vi.fn();

    render(
      <FinderScreen initialInput={COMPLETE_DIAGNOSTIC} onBack={vi.fn()} onDiscuss={onDiscuss} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Подобрать' }));

    expect(screen.getByRole('heading', { name: 'Подходящие направления' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Реставрация и приспособление ОКН' })).toBeTruthy();
    expect(screen.getByText(/не рассчитывает стоимость и срок проекта/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain('₽');
    expect(document.body.textContent).not.toContain('SLA');

    fireEvent.click(screen.getByRole('button', { name: 'Обсудить проект' }));
    expect(onDiscuss).toHaveBeenCalledTimes(1);
    const recommendations = onDiscuss.mock.calls[0]?.[0] as readonly {
      readonly service: string;
    }[];
    expect(recommendations).toHaveLength(3);
    expect(recommendations[0]?.service).toBe('restoration');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the diagnostic action disabled until every required answer is present', () => {
    render(<FinderScreen onBack={vi.fn()} onDiscuss={vi.fn()} />);

    const action = screen.getByRole('button', {
      name: 'Подобрать',
    }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
  });
});
