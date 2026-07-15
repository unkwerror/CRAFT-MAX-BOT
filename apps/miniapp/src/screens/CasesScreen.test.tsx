import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CasesScreen } from './CasesScreen.js';

afterEach(cleanup);

describe('CasesScreen', () => {
  it('filters the local catalog and delegates project actions', () => {
    const bridge = { openLink: vi.fn(() => true) };
    const onDiscuss = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<CasesScreen bridge={bridge} onBack={vi.fn()} onDiscuss={onDiscuss} />);

    expect(screen.getAllByRole('article')).toHaveLength(8);
    fireEvent.change(screen.getByLabelText('Тип объекта'), {
      target: { value: 'public-building' },
    });
    fireEvent.change(screen.getByLabelText('Услуга'), {
      target: { value: 'restoration' },
    });

    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(
      screen.getByRole('heading', { name: 'Реставрация исторического квартала в Тюмени' }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Страница проекта ↗' }));
    expect(bridge.openLink).toHaveBeenCalledWith(
      'https://craft72.ru/projects/tyumen-heritage-quarter',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Обсудить похожий' }));
    expect(onDiscuss).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tyumen-heritage-quarter' }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(screen.getAllByRole('article')).toHaveLength(8);
  });

  it('marks selected cases and reports a blocked external link', async () => {
    render(
      <CasesScreen
        bridge={{ openLink: () => false }}
        onBack={vi.fn()}
        onDiscuss={vi.fn()}
        selectedCaseIds={['tyumen-heritage-quarter']}
      />,
    );

    expect(screen.getByRole('button', { name: 'Убрать из брифа' })).toBeTruthy();
    const projectLink = screen.getAllByRole('button', { name: 'Страница проекта ↗' }).at(0);
    if (projectLink === undefined) {
      throw new Error('Expected a project link');
    }
    fireEvent.click(projectLink);
    expect(await screen.findByText(/не удалось открыть страницу проекта/i)).toBeTruthy();
  });
});
