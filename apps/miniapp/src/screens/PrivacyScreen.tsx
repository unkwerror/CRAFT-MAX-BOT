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

  if (onContinue !== undefined) {
    const canContinue = consentAccepted && termsAccepted;

    return (
      <Page className="page--narrow consent-page" withNavigation={false}>
        <section aria-labelledby="consent-start-title" className="consent-start">
          <div className="consent-start__intro">
            <span className="eyebrow">О данных</span>
            <h1 id="consent-start-title">Перед началом</h1>
            <p>Отметьте два пункта и нажмите «Продолжить».</p>
          </div>

          <div className="consent-start__choices">
            <label className="consent-choice">
              <input
                checked={consentAccepted}
                onChange={(event) => setConsentAccepted(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>
                <strong>Согласен на обработку персональных данных</strong>
                {policyUrl === undefined ? null : (
                  <a href={policyUrl} rel="noreferrer" target="_blank">
                    Политика конфиденциальности
                  </a>
                )}
              </span>
            </label>

            <label className="consent-choice">
              <input
                checked={termsAccepted}
                onChange={(event) => setTermsAccepted(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>
                <strong>Принимаю условия использования сервиса</strong>
                {termsUrl === undefined ? null : (
                  <a href={termsUrl} rel="noreferrer" target="_blank">
                    Условия использования
                  </a>
                )}
              </span>
            </label>
          </div>

          <button
            className="consent-start__continue"
            disabled={!canContinue}
            onClick={onContinue}
            type="button"
          >
            <span>Продолжить</span>
            <span aria-hidden="true">→</span>
          </button>
        </section>
      </Page>
    );
  }

  return (
    <Page className="page--narrow" withNavigation={false}>
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
          Анкета содержит сведения о проекте, контактный телефон, электронную почту и выбранные
          материалы. Без опубликованной политики приложение остаётся в браузерном preview-режиме и
          не передаёт их на сервер.
        </p>

        <h2>Черновик</h2>
        <p>
          В preview-режиме незавершённая анкета сохраняется в локальном хранилище браузера. После
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
      </article>
    </Page>
  );
};
