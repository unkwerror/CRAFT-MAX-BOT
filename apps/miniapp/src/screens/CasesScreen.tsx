import { useMemo, useState } from 'react';
import type { CaseCatalogItem, CaseId } from '@craft72/contracts/source';

import { CaseCard } from '../components/CaseCard.js';
import { FilterSelect } from '../components/FilterSelect.js';
import { InlineNotice } from '../components/FormControls.js';
import { Icon } from '../components/Icon.js';
import { Page, ScreenHeader } from '../components/Layout.js';
import {
  CONSTRUCTION_KIND_OPTIONS,
  OBJECT_TYPE_OPTIONS,
  SCALE_OPTIONS,
  SERVICE_OPTIONS,
} from '../content.js';
import { filterCaseCatalog, MOCK_CASE_CATALOG } from '../domain/case-catalog.js';
import { maxBridge, type MaxBridgeAdapter } from '../platform/index.js';

const uniqueValues = (values: readonly string[]): readonly string[] => [...new Set(values)];

interface CaseFilters {
  readonly objectType: string;
  readonly service: string;
  readonly region: string;
  readonly city: string;
  readonly scale: string;
  readonly constructionKind: string;
}

const EMPTY_FILTERS: CaseFilters = {
  objectType: '',
  service: '',
  region: '',
  city: '',
  scale: '',
  constructionKind: '',
};

export interface CasesScreenProps {
  readonly bridge?: Pick<MaxBridgeAdapter, 'openLink'>;
  readonly items?: readonly CaseCatalogItem[];
  readonly onBack: () => void;
  readonly onDiscuss: (item: CaseCatalogItem) => void;
  readonly selectedCaseIds?: readonly CaseId[];
}

export const CasesScreen = ({
  bridge = maxBridge,
  items = MOCK_CASE_CATALOG,
  onBack,
  onDiscuss,
  selectedCaseIds = [],
}: CasesScreenProps) => {
  const [filters, setFilters] = useState<CaseFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const cities = useMemo(
    () =>
      uniqueValues(
        items
          .filter((item) => filters.region === '' || item.region === filters.region)
          .map((item) => item.city),
      ),
    [filters.region, items],
  );
  const regions = useMemo(() => uniqueValues(items.map((item) => item.region)), [items]);
  const filteredCases = useMemo(
    () =>
      filterCaseCatalog(items, {
        ...(filters.objectType === '' ? {} : { objectType: filters.objectType }),
        ...(filters.service === '' ? {} : { service: filters.service }),
        ...(filters.region === '' ? {} : { region: filters.region }),
        ...(filters.city === '' ? {} : { city: filters.city }),
        ...(filters.scale === '' ? {} : { scale: filters.scale }),
        ...(filters.constructionKind === '' ? {} : { constructionKind: filters.constructionKind }),
      }),
    [filters, items],
  );
  const hasActiveFilters = Object.values(filters).some((value) => value !== '');

  const updateFilter = (patch: Partial<CaseFilters>): void => {
    setFilters((current) => ({ ...current, ...patch }));
  };

  const openCase = (url: string): void => {
    setLinkError(false);
    try {
      if (!bridge.openLink(url)) {
        setLinkError(true);
      }
    } catch {
      setLinkError(true);
    }
  };

  return (
    <Page>
      <ScreenHeader
        eyebrow="Портфолио"
        onBack={onBack}
        subtitle="Примеры работ бюро — выберите похожий объект или откройте страницу проекта."
        title="Проекты КРАФТ"
      />

      <InlineNotice icon="projects">
        Фото проектов с официального сайта КРАФТ. Можно сузить список фильтрами.
      </InlineNotice>

      <div className="filter-panel">
        <button
          aria-controls="case-filters"
          aria-expanded={filtersOpen}
          className={hasActiveFilters ? 'filter-panel__toggle is-active' : 'filter-panel__toggle'}
          onClick={() => setFiltersOpen((open) => !open)}
          type="button"
        >
          <span>
            <strong>Фильтры</strong>
            <small>
              {hasActiveFilters
                ? `Выбрано: ${String(Object.values(filters).filter((value) => value !== '').length)}`
                : 'Тип, услуга, город и другие параметры'}
            </small>
          </span>
          <Icon name="chevron" size={18} />
        </button>
        {filtersOpen ? (
          <section
            aria-label="Фильтры проектов"
            className="filter-bar filter-bar--compact"
            id="case-filters"
          >
            <FilterSelect
              label="Тип объекта"
              onChange={(objectType) => updateFilter({ objectType })}
              options={OBJECT_TYPE_OPTIONS}
              value={filters.objectType}
            />
            <FilterSelect
              label="Услуга"
              onChange={(service) => updateFilter({ service })}
              options={SERVICE_OPTIONS}
              value={filters.service}
            />
            <FilterSelect
              label="Масштаб"
              onChange={(scale) => updateFilter({ scale })}
              options={SCALE_OPTIONS}
              value={filters.scale}
            />
            <FilterSelect
              label="Тип работ"
              onChange={(constructionKind) => updateFilter({ constructionKind })}
              options={CONSTRUCTION_KIND_OPTIONS}
              value={filters.constructionKind}
            />
            <FilterSelect
              label="Регион"
              onChange={(region) =>
                updateFilter({
                  region,
                  ...(filters.city !== '' &&
                  !items.some(
                    (item) =>
                      item.city === filters.city && (region === '' || item.region === region),
                  )
                    ? { city: '' }
                    : {}),
                })
              }
              options={regions.map((region) => ({ label: region, value: region }))}
              value={filters.region}
            />
            <FilterSelect
              label="Город"
              onChange={(city) => updateFilter({ city })}
              options={cities.map((city) => ({ label: city, value: city }))}
              value={filters.city}
            />
          </section>
        ) : null}
      </div>

      {linkError ? (
        <InlineNotice icon="shield" tone="warning">
          Не удалось открыть страницу проекта. Проверьте настройки внешних ссылок в MAX.
        </InlineNotice>
      ) : null}

      <div className="section-heading">
        <div>
          <h2>Результаты</h2>
          <p>Найдено проектов: {filteredCases.length}</p>
        </div>
        {!hasActiveFilters ? null : (
          <button onClick={() => setFilters(EMPTY_FILTERS)} type="button">
            Сбросить фильтры
          </button>
        )}
      </div>

      {filteredCases.length === 0 ? (
        <div className="empty-result" role="status">
          <Icon name="search" size={28} />
          <h3>По этим фильтрам кейсов нет</h3>
          <p>Сбросьте один или несколько параметров и попробуйте снова.</p>
        </div>
      ) : (
        <div className="case-grid">
          {filteredCases.map((item) => (
            <CaseCard
              item={item}
              key={item.id}
              onDiscuss={onDiscuss}
              onOpen={openCase}
              selected={selectedCaseIds.includes(item.id)}
            />
          ))}
        </div>
      )}
    </Page>
  );
};
