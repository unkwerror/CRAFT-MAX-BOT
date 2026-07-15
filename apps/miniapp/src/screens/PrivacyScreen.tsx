import { privacyConsentText, termsAcceptanceText } from '@craft72/contracts/source';
import { useState } from 'react';

import { InlineNotice } from '../components/FormControls.js';
import { Page, ScreenHeader } from '../components/Layout.js';

export interface PrivacyScreenProps {
  readonly consentVersion?: string;
  readonly onBack: () => void;
  readonly onContinue?: () => void;
  readonly policyUrl?: string;
  readonly termsUrl?: string;
}

export const PrivacyScreen = ({
  consentVersion,
  onBack,
  onContinue,
  policyUrl,
  termsUrl,
}: PrivacyScreenProps) => {
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const consentText = privacyConsentText(consentVersion ?? 'preview');
  const termsText = termsAcceptanceText(consentVersion ?? 'preview');

  return (
    <Page className="page--narrow">
      <ScreenHeader
        eyebrow="О данных"
        onBack={onBack}
        subtitle="Какие данные нужны сервису и как они защищены"
        title="Прозрачная работа с данными"
      />

      <article className="content-card privacy-copy">
        {policyUrl === undefined ? (
          <InlineNotice icon="warning" tone="warning">
            <strong>Демонстрационный режим</strong>
            <p>
              Это информационный макет, а не утверждённая политика обработки персональных данных.
              Юридический текст, реквизиты оператора и сроки хранения должны быть согласованы до
              production-запуска формы.
            </p>
          </InlineNotice>
        ) : (
          <InlineNotice icon="shield" tone="success">
            <strong>Политика CRAFT72 Mini App</strong>
            <p>
              Полный юридический текст, реквизиты оператора, сроки хранения и порядок удаления
              опубликованы{' '}
              <a href={policyUrl} rel="noreferrer" target="_blank">
                по этой ссылке
              </a>
              . Версия согласия: {consentVersion}.
            </p>
          </InlineNotice>
        )}

        <h2>Какие данные использует Mini App</h2>
        <p>
          Бриф содержит сведения о проекте, контактный телефон, электронную почту и выбранные
          материалы. Без опубликованной политики приложение остаётся в браузерном preview-режиме и
          не передаёт их на сервер.
        </p>

        <h2>Черновик</h2>
        <p>
          В preview-режиме незавершённый бриф сохраняется в локальном хранилище браузера. После
          включения production-режима авторизованный MAX-пользователь получает короткоживущую
          серверную сессию, а черновик сохраняется на сервере.
        </p>

        <h2>Телефон из MAX</h2>
        <p>
          Mini App может запросить контакт через MAX Bridge. Отказ не блокирует форму: телефон можно
          указать вручную. В production-режиме подпись переданного контакта проверяется сервером.
        </p>

        <h2>Файлы</h2>
        <p>
          До подключения закрытого файлового хранилища физические файлы на production-сервер не
          передаются. Для обсуждения проекта можно добавить HTTPS-ссылку на защищённое облако.
        </p>

        {onContinue === undefined ? null : (
          <section className="consent-gate" aria-labelledby="consent-gate-title">
            <h2 id="consent-gate-title">Согласие на обработку данных</h2>
            <label className="consent-control">
              <input
                checked={consentAccepted}
                onChange={(event) => setConsentAccepted(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>{consentText}</span>
            </label>
            <label className="consent-control">
              <input
                checked={termsAccepted}
                onChange={(event) => setTermsAccepted(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>
                {termsText}{' '}
                {termsUrl === undefined ? null : (
                  <a href={termsUrl} rel="noreferrer" target="_blank">
                    Открыть условия использования.
                  </a>
                )}
              </span>
            </label>
            <p className="consent-gate__hint">
              Галочка не установлена заранее. Без согласия MAX-профиль и введённые данные не
              отправляются на сервер; Mini App можно закрыть без последствий.
            </p>
            <button
              className="save-exit"
              disabled={!consentAccepted || !termsAccepted}
              onClick={onContinue}
              type="button"
            >
              Даю согласие и продолжить
            </button>
          </section>
        )}
      </article>
    </Page>
  );
};
