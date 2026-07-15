import { Button } from '@maxhub/max-ui';
import type { CaseCatalogItem } from '@craft72/contracts/source';

import { labelFor, OBJECT_TYPE_OPTIONS, SERVICE_OPTIONS } from '../content.js';
import { Icon } from './Icon.js';

export interface CaseCardProps {
  readonly item: CaseCatalogItem;
  readonly onDiscuss: (item: CaseCatalogItem) => void;
  readonly onOpen: (url: string) => void;
  readonly selected?: boolean;
}

const formatArea = (area: number | null): string | null =>
  area === null ? null : `${area.toLocaleString('ru-RU')} м²`;

export const CaseCard = ({ item, onDiscuss, onOpen, selected = false }: CaseCardProps) => (
  <article className="case-card">
    <div
      className="case-card__visual"
      role="img"
      aria-label={`Архитектурная схема проекта «${item.title}»`}
    >
      <span className="case-card__visual-label">{item.status}</span>
    </div>
    <div className="case-card__body">
      <span className="case-card__location">
        <Icon name="location" size={14} />
        {item.city}
      </span>
      <h3>{item.title}</h3>
      <div className="case-card__meta">
        {formatArea(item.area) === null ? null : <span>{formatArea(item.area)}</span>}
        {item.categories.slice(0, 1).map((category) => (
          <span key={category}>{labelFor(OBJECT_TYPE_OPTIONS, category)}</span>
        ))}
        {item.services.slice(0, 2).map((service) => (
          <span key={service}>{labelFor(SERVICE_OPTIONS, service)}</span>
        ))}
      </div>
      <div className="case-card__actions">
        <button className="case-link" onClick={() => onOpen(item.url)} type="button">
          Страница проекта ↗
        </button>
        <Button
          mode={selected ? 'secondary' : 'primary'}
          onClick={() => onDiscuss(item)}
          size="small"
          type="button"
        >
          {selected ? 'Убрать из брифа' : 'Обсудить похожий'}
        </Button>
      </div>
    </div>
  </article>
);
