import { Button } from '@maxhub/max-ui';
import type { DocumentScanStatus, Submission } from '@craft72/contracts/source';

import { Icon } from '../components/Icon.js';
import { Page } from '../components/Layout.js';

const SCAN_STATUS_LABELS: Readonly<Record<DocumentScanStatus, string>> = {
  clean: 'Проверен',
  failed: 'Требует проверки',
  infected: 'Отклонён проверкой',
  pending: 'Принят',
  scanning: 'Проверяется',
};

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${String(bytes)} Б`;
  if (bytes < 1_048_576)
    return `${(bytes / 1_024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} КБ`;
  return `${(bytes / 1_048_576).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`;
}

export interface SuccessScreenProps {
  readonly onAddMaterials: () => void;
  readonly onHome: () => void;
  readonly onOpenChat: () => void;
  readonly submission: Submission;
}

export const SuccessScreen = ({
  onAddMaterials,
  onHome,
  onOpenChat,
  submission,
}: SuccessScreenProps) => (
  <Page className="page--narrow page-stack" withNavigation={false}>
    <section className="success-hero">
      <span className="success-hero__icon">
        <Icon name="check" size={34} />
      </span>
      <h1>Заявка принята</h1>
      <p>
        Демонстрационный API принял сведения и материалы в текущей сессии. Идентификатор ниже
        позволяет проверить идемпотентный mock-сценарий.
      </p>
      <div className="submission-id">
        <span>Идентификатор заявки</span>
        <strong>{submission.submissionId}</strong>
      </div>
    </section>

    <div className="summary-sections">
      <section className="summary-card">
        <div className="summary-card__head">
          <h2>Полученные материалы</h2>
        </div>
        <dl>
          {submission.materials.length === 0 ? (
            <>
              <dt>Файлы</dt>
              <dd>Не добавлены</dd>
            </>
          ) : (
            submission.materials.map((material) => (
              <div key={material.id} style={{ display: 'contents' }}>
                <dt>{material.originalName}</dt>
                <dd>
                  {formatBytes(material.sizeBytes)} · {SCAN_STATUS_LABELS[material.scanStatus]}
                </dd>
              </div>
            ))
          )}
        </dl>
      </section>

      <section className="summary-card">
        <div className="summary-card__head">
          <h2>Подходящие проекты</h2>
        </div>
        <dl>
          {submission.matchedCases.length === 0 ? (
            <>
              <dt>Проекты</dt>
              <dd>Подборка пока не сформирована</dd>
            </>
          ) : (
            submission.matchedCases.map((item) => (
              <div key={item.id} style={{ display: 'contents' }}>
                <dt>{item.title}</dt>
                <dd>
                  {item.city}, {item.region}
                </dd>
              </div>
            ))
          )}
        </dl>
      </section>
    </div>

    <div className="success-actions">
      <Button mode="secondary" onClick={onAddMaterials} size="large" type="button">
        Новый бриф с материалами
      </Button>
      <Button mode="secondary" onClick={onOpenChat} size="large" type="button">
        Открыть чат
      </Button>
      <Button onClick={onHome} size="large" type="button">
        На главную
      </Button>
    </div>
  </Page>
);
