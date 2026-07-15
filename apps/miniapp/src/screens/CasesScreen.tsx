import { useMemo, useState } from 'react';
import type { CaseCatalogItem, CaseId } from '@craft72/contracts/source';

import { CaseCard } from '../components/CaseCard.js';
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

const REGIONS = uniqueValues(MOCK_CASE_CATALOG.map((item) => item.region));

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

interface FilterSelectProps {
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly value: string;
}

const FilterSelect = ({ label, onChange, options, value }: FilterSelectProps) => (
  <label className="filter-control">
    <span>{label}</span>
    <select onChange={(event) => onChange(event.currentTarget.value)} value={value}>
      <option value="">Все</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

export interface CasesScreenProps {
  readonly bridge?: Pick<MaxBridgeAdapter, 'openLink'>;
  readonly onBack: () => void;
  readonly onDiscuss: (item: CaseCatalogItem) => void;
  readonly selectedCaseIds?: readonly CaseId[];
}

export const CasesScreen = ({
  bridge = maxBridge,
  onBack,
  onDiscuss,
  selectedCaseIds = [],
}: CasesScreenProps) => {
  const [filters, setFilters] = useState<CaseFilters>(EMPTY_FILTERS);
  const [linkError, setLinkError] = useState(false);
  const cities = useMemo(
    () =>
      uniqueValues(
        MOCK_CASE_CATALOG.filter(
          (item) => filters.region === '' || item.region === filters.region,
        ).map((item) => item.city),
      ),
    [filters.region],
  );
  const filteredCases = useMemo(
    () =>
      filterCaseCatalog(MOCK_CASE_CATALOG, {
        ...(filters.objectType === '' ? {} : { objectType: filters.objectType }),
        ...(filters.service === '' ? {} : { service: filters.service }),
        ...(filters.region === '' ? {} : { region: filters.region }),
        ...(filters.city === '' ? {} : { city: filters.city }),
        ...(filters.scale === '' ? {} : { scale: filters.scale }),
        ...(filters.constructionKind === '' ? {} : { constructionKind: filters.constructionKind }),
      }),
    [filters],
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
        subtitle="Реальные проекты из опубликованного портфолио CRAFT GROUP."
        title="Проекты CRAFT72"
      />

      <InlineNotice icon="projects">
        Изображения сохранены в приложении с официального сайта — каталог не зависит от
        runtime-скрейпинга.
      </InlineNotice>

      <section aria-label="Фильтры проектов" className="filter-bar">
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
              !MOCK_CASE_CATALOG.some(
                (item) => item.city === filters.city && (region === '' || item.region === region),
              )
                ? { city: '' }
                : {}),
            })
          }
          options={REGIONS.map((region) => ({ label: region, value: region }))}
          value={filters.region}
        />
        <FilterSelect
          label="Город"
          onChange={(city) => updateFilter({ city })}
          options={cities.map((city) => ({ label: city, value: city }))}
          value={filters.city}
        />
      </section>

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
