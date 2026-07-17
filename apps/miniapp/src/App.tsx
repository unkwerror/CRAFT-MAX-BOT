import { MaxUI } from '@maxhub/max-ui';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  CaseCatalogItem,
  LeadDraft,
  LeadDraftFormState,
  LeadFormData,
  Submission,
} from '@craft72/contracts/source';

import { Stage3ApiClient, Stage3ApiClientError } from './api/index.js';
import { createEmptyDraft, toFinalLeadForm } from './brief/draft.js';
import { InlineNotice } from './components/FormControls.js';
import {
  AppTopbar,
  BottomNav,
  LoadingScreen,
  Page,
  Toast,
  type StatusTone,
  type ToastTone,
} from './components/Layout.js';
import type { ServiceRecommendation } from './domain/index.js';
import {
  createBrowserDraftStorage,
  LocalStorageDraftRepository,
  MockSessionState,
  MockSubmissionApi,
  MockUploadApi,
} from './mock/index.js';
import {
  getRouteFromHash,
  getRouteFromStartParam,
  routeHref,
  type AppRoute,
} from './navigation.js';
import { maxBridge } from './platform/index.js';
import { maxBotConfiguration } from './runtime/bot-config.js';
import { getDocumentReadiness } from './runtime/document-readiness.js';
import { privacyConfiguration } from './runtime/privacy-config.js';
import { BRIEF_TOTAL_STEPS, BriefScreen, type BriefStep } from './screens/BriefScreen.js';
import { CasesScreen } from './screens/CasesScreen.js';
import { FinderScreen } from './screens/FinderScreen.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { PrivacyScreen } from './screens/PrivacyScreen.js';
import { SuccessScreen } from './screens/SuccessScreen.js';
import { SummaryScreen } from './screens/SummaryScreen.js';
import { UploadScreen } from './screens/UploadScreen.js';

type ToastState = { message: string; tone: ToastTone } | null;
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const asBriefStep = (value: number): BriefStep =>
  Math.max(1, Math.min(BRIEF_TOTAL_STEPS, Math.trunc(value))) as BriefStep;

const cleanDraftForValidation = (draft: LeadDraftFormState): LeadDraftFormState => ({
  ...draft,
  links: (draft.links ?? []).map((link) => link.trim()).filter((link) => link !== ''),
});

const safeFinalForm = (draft: LeadDraftFormState): LeadFormData | null => {
  try {
    return toFinalLeadForm(cleanDraftForValidation(draft));
  } catch {
    return null;
  }
};

const formatDraftTimestamp = (value: string): string => {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return 'Черновик сохранён на этом устройстве';

  return `Сохранено ${new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }).format(timestamp)}`;
};

const activeNavigationRoute = (route: AppRoute): AppRoute => {
  if (route === 'cases') return 'cases';
  if (route === 'upload') return 'upload';
  if (route === 'brief' || route === 'summary') return 'brief';
  return 'home';
};

type RuntimeStatus = 'awaiting-consent' | 'connected' | 'connecting' | 'error' | 'preview';

const runtimeStatusTone = (status: RuntimeStatus): StatusTone => {
  if (status === 'connected') return 'ok';
  if (status === 'connecting' || status === 'awaiting-consent') return 'warn';
  if (status === 'error') return 'error';
  return 'neutral';
};

const normalizeServerDraft = (draft: LeadDraftFormState): LeadDraftFormState => ({
  ...draft,
  consent: {
    accepted:
      draft.consent?.version === privacyConfiguration.consentVersion &&
      draft.consent.accepted === true,
    version: privacyConfiguration.consentVersion,
  },
});

const RuntimeUnavailableScreen = ({
  onRetry,
  onSupport,
}: {
  readonly onRetry: () => void;
  readonly onSupport?: () => void;
}) => (
  <Page className="page--narrow" withNavigation={false}>
    <section className="content-card privacy-copy">
      <h1>Сервис временно недоступен</h1>
      <InlineNotice icon="warning" tone="warning">
        <strong>MAX-сессия не установлена</strong>
        <span>
          Данные заявки не отправлялись. Закройте и снова откройте Mini App из MAX либо повторите
          позже.
        </span>
      </InlineNotice>
      <button className="save-exit" onClick={onRetry} type="button">
        Повторить подключение
      </button>
      {onSupport === undefined ? null : (
        <button className="save-exit" onClick={onSupport} type="button">
          Связаться с менеджером
        </button>
      )}
    </section>
  </Page>
);

export const App = () => {
  const browserStorage = useMemo(() => createBrowserDraftStorage(), []);
  const serverApi = useMemo(() => new Stage3ApiClient(), []);
  const initData = useMemo(() => maxBridge.getInitData(), []);
  const shouldUseServer = privacyConfiguration.productionDataEnabled && initData !== null;
  const termsUrl = useMemo(
    () =>
      privacyConfiguration.policyUrl === null
        ? null
        : new URL('terms.html', privacyConfiguration.policyUrl).toString(),
    [],
  );
  const draftRepository = useMemo(
    () => new LocalStorageDraftRepository(browserStorage),
    [browserStorage],
  );
  const uploadApi = useMemo(() => new MockUploadApi({ storage: browserStorage }), [browserStorage]);
  const session = useMemo(() => new MockSessionState(), []);
  const submissionApi = useMemo(
    () => new MockSubmissionApi({ documentSource: uploadApi, session }),
    [session, uploadApi],
  );
  const initialSavedDraft = useMemo(
    () => (shouldUseServer ? null : draftRepository.load()),
    [draftRepository, shouldUseServer],
  );
  const draftSaveQueue = useRef<Promise<void>>(Promise.resolve());

  const [route, setRoute] = useState<AppRoute>(() => getRouteFromHash(window.location.hash));
  const [savedDraft, setSavedDraft] = useState<LeadDraft | null>(initialSavedDraft);
  const [draft, setDraft] = useState<LeadDraftFormState>(
    () => initialSavedDraft?.payload ?? createEmptyDraft(privacyConfiguration.consentVersion),
  );
  const [briefStep, setBriefStep] = useState<BriefStep>(() =>
    asBriefStep(initialSavedDraft?.currentStep ?? 1),
  );
  const [hasActiveDraft, setHasActiveDraft] = useState(initialSavedDraft !== null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [returnToSummaryAfterEdit, setReturnToSummaryAfterEdit] = useState(false);
  const [requestingContact, setRequestingContact] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(
    shouldUseServer ? 'awaiting-consent' : 'preview',
  );
  const [serverVerifiedPhone, setServerVerifiedPhone] = useState<string | null>(null);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(!shouldUseServer);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [toast, setToast] = useState<ToastState>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveStatusText, setSaveStatusText] = useState<string | undefined>();
  const [theme, setTheme] = useState(() => maxBridge.getTheme());

  const showToast = useCallback((message: string, tone: ToastTone): void => {
    setToast({ message, tone });
  }, []);

  const navigate = useCallback((nextRoute: AppRoute): void => {
    const href = routeHref(nextRoute);
    if (window.location.hash !== href) window.location.hash = href;
    setRoute(nextRoute);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  const persistDraft = useCallback(
    async (nextDraft: LeadDraftFormState, step: BriefStep): Promise<LeadDraft> => {
      if (!shouldUseServer) {
        const stored = draftRepository.saveAfterStep({ currentStep: step, payload: nextDraft });
        setSavedDraft(stored);
        return stored;
      }

      if (runtimeStatus !== 'connected' || !privacyAcknowledged) {
        throw new Error('The production session is not connected');
      }

      const save = draftSaveQueue.current.then(async () => {
        const response = await serverApi.upsertDraft({
          currentStep: step,
          payload: normalizeServerDraft(nextDraft),
        });
        setSavedDraft(response.draft);
        return response.draft;
      });
      draftSaveQueue.current = save.then(
        () => undefined,
        () => undefined,
      );
      return save;
    },
    [draftRepository, privacyAcknowledged, runtimeStatus, serverApi, shouldUseServer],
  );

  const updateDraft = useCallback((nextDraft: LeadDraftFormState): void => {
    setHasActiveDraft(true);
    setDraft(nextDraft);
  }, []);

  useEffect(() => {
    if (!shouldUseServer || initData === null || !privacyAcknowledged) return undefined;

    const controller = new AbortController();
    let active = true;
    setRuntimeStatus('connecting');

    void (async () => {
      try {
        const authenticated = await serverApi.authenticate(
          initData,
          privacyConfiguration.consentVersion,
          { signal: controller.signal },
        );
        const response = await serverApi.getDraft({ signal: controller.signal });
        const missingDocumentIds = new Set<string>();
        if (response.draft !== null) {
          await Promise.all(
            [...new Set(response.draft.payload.documentIds ?? [])].map(async (documentId) => {
              try {
                await serverApi.fetchDocument(documentId, { signal: controller.signal });
              } catch (error) {
                if (
                  error instanceof Stage3ApiClientError &&
                  (error.code === 'NOT_FOUND' || error.code === 'UPLOAD_NOT_FOUND')
                ) {
                  missingDocumentIds.add(documentId);
                }
              }
            }),
          );
        }
        if (!active) return;
        if (!serverApi.hasSession()) throw new Error('The production session has expired');

        setServerVerifiedPhone(authenticated.session.verifiedContact?.phone ?? null);
        if (response.draft === null) {
          setSavedDraft(null);
          setDraft(createEmptyDraft(privacyConfiguration.consentVersion));
          setBriefStep(1);
          setHasActiveDraft(false);
        } else {
          const normalizedPayload = normalizeServerDraft(response.draft.payload);
          const payload = {
            ...normalizedPayload,
            documentIds: (normalizedPayload.documentIds ?? []).filter(
              (documentId) => !missingDocumentIds.has(documentId),
            ),
          };
          setSavedDraft({ ...response.draft, payload });
          setDraft(payload);
          setBriefStep(asBriefStep(response.draft.currentStep));
          setHasActiveDraft(true);
        }
        setRuntimeStatus('connected');
        navigate(getRouteFromStartParam(authenticated.startParam));
      } catch {
        if (!active || controller.signal.aborted) return;
        serverApi.clearSession();
        setRuntimeStatus('error');
        showToast('Не удалось установить защищённую MAX-сессию', 'error');
      }
    })();

    return () => {
      active = false;
      controller.abort();
      serverApi.clearSession();
    };
  }, [initData, navigate, privacyAcknowledged, serverApi, shouldUseServer, showToast]);

  useEffect(() => {
    const syncRoute = (): void => setRoute(getRouteFromHash(window.location.hash));
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    // v2 tokens: light #f2f2ef, dark #111315
    themeColor?.setAttribute('content', theme === 'dark' ? '#111315' : '#f2f2ef');
    return maxBridge.subscribeTheme(setTheme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    const apply = (viewport: { width: number; height: number }): void => {
      if (!active) return;
      document.documentElement.style.setProperty(
        '--app-viewport-height',
        viewport.height > 0 ? `${String(viewport.height)}px` : '100dvh',
      );
      document.documentElement.style.setProperty(
        '--app-viewport-width',
        viewport.width > 0 ? `${String(viewport.width)}px` : '100vw',
      );
    };

    void maxBridge.getViewportSize().then(apply);
    const unsubViewport = maxBridge.subscribeViewport(apply);

    return () => {
      active = false;
      unsubViewport();
    };
  }, []);

  useEffect(() => {
    if (hasActiveDraft) maxBridge.enableClosingConfirmation();
    else maxBridge.disableClosingConfirmation();
    return () => maxBridge.disableClosingConfirmation();
  }, [hasActiveDraft]);

  useEffect(() => {
    if (!hasActiveDraft) return undefined;
    if (shouldUseServer && !privacyAcknowledged) return undefined;
    setSaveStatus((current) => (current === 'saved' ? current : 'saving'));
    const timeout = window.setTimeout(() => {
      void persistDraft(draft, briefStep)
        .then((stored) => {
          setSaveStatus('saved');
          setSaveStatusText(formatDraftTimestamp(stored.updatedAt));
        })
        .catch(() => {
          setSaveStatus('error');
          showToast(
            shouldUseServer
              ? 'Не удалось сохранить черновик на сервере'
              : 'Не удалось сохранить черновик на этом устройстве',
            'error',
          );
        });
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [
    briefStep,
    draft,
    hasActiveDraft,
    persistDraft,
    privacyAcknowledged,
    shouldUseServer,
    showToast,
  ]);

  useEffect(() => {
    if (toast === null) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const handleBack = useCallback((): void => {
    if (route === 'brief' && briefStep > 1) {
      setBriefStep(asBriefStep(briefStep - 1));
      return;
    }
    if (route === 'summary') {
      setBriefStep(17);
      navigate('brief');
      return;
    }
    if (route === 'upload' && hasActiveDraft) {
      navigate('brief');
      return;
    }
    navigate('home');
  }, [briefStep, hasActiveDraft, navigate, route]);

  useEffect(() => {
    if (!maxBridge.isAvailable()) return undefined;
    if (route === 'home') {
      maxBridge.backButton.hide();
      return undefined;
    }

    maxBridge.backButton.show();
    const unsubscribe = maxBridge.backButton.subscribe(handleBack);
    return () => {
      unsubscribe();
      maxBridge.backButton.hide();
    };
  }, [handleBack, route]);

  const openBrief = useCallback((): void => {
    if (shouldUseServer && runtimeStatus !== 'connected') {
      showToast('Дождитесь подключения защищённой MAX-сессии', 'warning');
      return;
    }
    if (shouldUseServer && !privacyAcknowledged) {
      navigate('privacy');
      return;
    }
    setHasActiveDraft(true);
    navigate('brief');
  }, [navigate, privacyAcknowledged, runtimeStatus, shouldUseServer, showToast]);

  const handleNavigation = useCallback(
    (nextRoute: AppRoute): void => {
      if (nextRoute === 'brief') openBrief();
      else navigate(nextRoute);
    },
    [navigate, openBrief],
  );

  const handleBriefContinue = useCallback(
    async (nextDraft: LeadDraftFormState): Promise<void> => {
      setIsSaving(true);
      setSaveStatus('saving');
      await Promise.resolve();
      try {
        const cleaned = cleanDraftForValidation(nextDraft);
        setDraft(cleaned);
        setHasActiveDraft(true);
        if (returnToSummaryAfterEdit && safeFinalForm(cleaned) !== null) {
          const stored = await persistDraft(cleaned, 17);
          setSaveStatus('saved');
          setSaveStatusText(formatDraftTimestamp(stored.updatedAt));
          setReturnToSummaryAfterEdit(false);
          navigate('summary');
        } else if (briefStep < BRIEF_TOTAL_STEPS) {
          const nextStep = asBriefStep(briefStep + 1);
          const stored = await persistDraft(cleaned, nextStep);
          setSaveStatus('saved');
          setSaveStatusText(formatDraftTimestamp(stored.updatedAt));
          setBriefStep(nextStep);
        } else {
          const stored = await persistDraft(cleaned, 17);
          setSaveStatus('saved');
          setSaveStatusText(formatDraftTimestamp(stored.updatedAt));
          setReturnToSummaryAfterEdit(false);
          navigate('summary');
        }
      } catch {
        setSaveStatus('error');
        showToast('Не удалось сохранить черновик. Проверьте подключение и повторите.', 'error');
      } finally {
        setIsSaving(false);
      }
    },
    [briefStep, navigate, persistDraft, returnToSummaryAfterEdit, showToast],
  );

  const handleSaveAndExit = useCallback(
    async (nextDraft: LeadDraftFormState): Promise<void> => {
      setIsSaving(true);
      setSaveStatus('saving');
      await Promise.resolve();
      try {
        const cleaned = cleanDraftForValidation(nextDraft);
        setDraft(cleaned);
        setHasActiveDraft(true);
        const stored = await persistDraft(cleaned, briefStep);
        setSaveStatus('saved');
        setSaveStatusText(formatDraftTimestamp(stored.updatedAt));
        setReturnToSummaryAfterEdit(false);
        showToast('Черновик сохранён', 'success');
        navigate('home');
      } catch {
        setSaveStatus('error');
        showToast('Не удалось сохранить черновик. Проверьте подключение и повторите.', 'error');
      } finally {
        setIsSaving(false);
      }
    },
    [briefStep, navigate, persistDraft, showToast],
  );

  const handleEditStep = useCallback(
    (step: BriefStep): void => {
      setBriefStep(step);
      setHasActiveDraft(true);
      setReturnToSummaryAfterEdit(true);
      navigate('brief');
    },
    [navigate],
  );

  const handleRequestContact = useCallback(async (): Promise<void> => {
    setRequestingContact(true);
    try {
      const contact = await maxBridge.requestContact();
      let phone: string;
      if (shouldUseServer) {
        if (runtimeStatus !== 'connected') {
          throw new Error('The production session is not connected');
        }
        const verified = await serverApi.verifyContact(contact);
        phone = verified.phone;
        setServerVerifiedPhone(verified.phone);
      } else {
        phone = contact.phone.startsWith('+') ? contact.phone : `+${contact.phone}`;
        session.setVerifiedContact({ phone, verifiedAt: new Date().toISOString() });
      }
      setDraft((current) => ({
        ...current,
        contact: { ...current.contact, phone },
      }));
      setHasActiveDraft(true);
      showToast('Контакт получен из MAX', 'success');
    } catch {
      showToast(
        shouldUseServer
          ? 'Не удалось проверить контакт через MAX — введите номер вручную'
          : 'MAX не передал контакт — введите номер вручную',
        'warning',
      );
    } finally {
      setRequestingContact(false);
    }
  }, [runtimeStatus, serverApi, session, shouldUseServer, showToast]);

  const handleFinderDiscuss = useCallback(
    (recommendations: readonly ServiceRecommendation[]): void => {
      const services = [
        ...new Set([...(draft.services ?? []), ...recommendations.map((item) => item.service)]),
      ];
      updateDraft({ ...draft, services });
      // Soft-add: toast only — user navigates to brief via bottom nav when ready
      showToast('Направления сохранены в анкете', 'success');
    },
    [draft, showToast, updateDraft],
  );

  const handleCaseDiscuss = useCallback(
    (item: CaseCatalogItem): void => {
      if (draft.selectedCaseIds?.includes(item.id) === true) {
        updateDraft({
          ...draft,
          selectedCaseIds: draft.selectedCaseIds.filter((caseId) => caseId !== item.id),
        });
        showToast('Проект убран из анкеты', 'success');
        return;
      }
      const selectedCaseIds = [...new Set([...(draft.selectedCaseIds ?? []), item.id])];
      updateDraft({ ...draft, selectedCaseIds });
      // Soft-add: toast only — do not openBrief()
      showToast('Проект добавлен в анкету', 'success');
    },
    [draft, showToast, updateDraft],
  );

  const handleOpenManagerChat = useCallback((): void => {
    // 1) Phone (tel:) — preferred for direct call / handoff by number
    // 2) MAX user deep-link
    // 3) Bot profile as last resort
    try {
      if (maxBotConfiguration.managerPhone !== null) {
        const dialed = maxBridge.openPhone(maxBotConfiguration.managerPhone);
        if (dialed) {
          maxBridge.close();
          return;
        }
      }

      const managerLink = maxBotConfiguration.managerUrl ?? maxBotConfiguration.url;
      if (managerLink === null) {
        showToast(
          maxBotConfiguration.managerPhone === null
            ? 'Чат с менеджером временно недоступен. Закройте приложение и напишите боту КРАФТ в MAX.'
            : `Не удалось открыть звонок. Позвоните менеджеру: ${maxBotConfiguration.managerPhone}`,
          'error',
        );
        return;
      }

      const opened = maxBridge.openMaxLink(managerLink);
      if (!opened) {
        showToast(
          maxBotConfiguration.managerPhone === null
            ? 'Не удалось открыть чат. Закройте Mini App и напишите менеджеру КРАФТ в MAX.'
            : `Не удалось открыть чат. Позвоните: ${maxBotConfiguration.managerPhone}`,
          'error',
        );
        return;
      }
      maxBridge.close();
    } catch {
      showToast(
        maxBotConfiguration.managerPhone === null
          ? 'Не удалось открыть чат. Закройте Mini App и напишите менеджеру КРАФТ в MAX.'
          : `Не удалось открыть чат. Позвоните: ${maxBotConfiguration.managerPhone}`,
        'error',
      );
    }
  }, [showToast]);

  const handleDocumentAdded = useCallback((documentId: string): void => {
    setDraft((current) => ({
      ...current,
      documentIds: [...new Set([...(current.documentIds ?? []), documentId])],
    }));
    setHasActiveDraft(true);
  }, []);

  const handleDocumentRemoved = useCallback((documentId: string): void => {
    setDraft((current) => ({
      ...current,
      documentIds: (current.documentIds ?? []).filter((id) => id !== documentId),
    }));
    setHasActiveDraft(true);
  }, []);

  const handleDocumentDownload = useCallback(
    async (documentId: string): Promise<void> => {
      try {
        const response = await serverApi.createDownloadLink(documentId);
        if (!maxBridge.openLink(response.downloadUrl)) {
          showToast('Не удалось открыть ссылку на файл', 'error');
        }
      } catch {
        showToast('Не удалось подготовить ссылку на файл', 'error');
      }
    },
    [serverApi, showToast],
  );

  const handleUploadToast = useCallback(
    (message: string): void => {
      let tone: ToastTone = 'error';
      if (/загружен/i.test(message)) tone = 'success';
      else if (/будет доступна/i.test(message)) tone = 'warning';
      showToast(message, tone);
    },
    [showToast],
  );

  const finalForm = useMemo(() => safeFinalForm(draft), [draft]);
  const phoneVerified =
    (shouldUseServer ? serverVerifiedPhone : session.verifiedContact?.phone) ===
    draft.contact?.phone;
  const documentNames = useMemo(() => {
    const documentSource = shouldUseServer ? serverApi : uploadApi;
    return (draft.documentIds ?? []).flatMap((documentId) => {
      try {
        const document = documentSource.getDocument(documentId);
        return document === null ? [] : [document.originalName];
      } catch {
        return [];
      }
    });
  }, [draft.documentIds, serverApi, shouldUseServer, uploadApi]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    const form = safeFinalForm(draft);
    if (form === null) {
      setSubmitError('Проверьте обязательные поля анкеты. Введённые данные сохранены.');
      return;
    }
    if (shouldUseServer) {
      const documentReadiness = getDocumentReadiness(form.documentIds, (documentId) =>
        serverApi.getDocument(documentId),
      );
      if (documentReadiness === 'checking') {
        setSubmitError('Дождитесь завершения проверки файлов и повторите отправку.');
        return;
      }
      if (documentReadiness === 'rejected') {
        setSubmitError('Удалите файлы, которые не прошли проверку безопасности.');
        return;
      }
    }
    setSubmitError(undefined);
    setIsSubmitting(true);
    await Promise.resolve();
    try {
      const stored = await persistDraft(cleanDraftForValidation(draft), 17);
      const response = shouldUseServer
        ? await serverApi.createSubmission({
            draftId: stored.id,
            idempotencyKey: `stage3:${stored.id}`,
            payload: form,
          })
        : submissionApi.createSubmission({
            draftId: stored.id,
            idempotencyKey: `stage2-${stored.id}`,
            payload: form,
          });
      setSubmission(response.submission);
      draftRepository.clear();
      setSavedDraft(null);
      setHasActiveDraft(false);
      setDraft(createEmptyDraft(privacyConfiguration.consentVersion));
      setServerVerifiedPhone(null);
      setBriefStep(1);
      navigate('success');
    } catch {
      setSubmitError(
        shouldUseServer
          ? 'Сервер не принял заявку. Проверьте подключение и повторите отправку — дубликат не создастся.'
          : 'Preview API не принял заявку. Проверьте материалы или поля и повторите отправку.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [draft, draftRepository, navigate, persistDraft, serverApi, shouldUseServer, submissionApi]);

  useEffect(() => {
    if (route === 'summary' && finalForm === null) {
      setBriefStep(1);
      navigate('brief');
    }
    if (route === 'success' && submission === null) navigate('home');
  }, [finalForm, navigate, route, submission]);

  let screen: ReactNode;
  switch (route) {
    case 'home':
      screen = (
        <HomeScreen
          draftStep={hasActiveDraft ? (savedDraft?.currentStep ?? briefStep) : null}
          {...(savedDraft === null
            ? {}
            : { draftUpdatedAt: formatDraftTimestamp(savedDraft.updatedAt) })}
          onNavigate={handleNavigation}
          onSupport={handleOpenManagerChat}
        />
      );
      break;
    case 'finder':
      screen = <FinderScreen onBack={handleBack} onDiscuss={handleFinderDiscuss} />;
      break;
    case 'brief':
      screen = (
        <BriefScreen
          consentVersion={privacyConfiguration.consentVersion}
          draft={draft}
          isSaving={isSaving}
          materialCount={draft.documentIds?.length ?? 0}
          onBack={handleBack}
          onContinue={handleBriefContinue}
          onDraftChange={updateDraft}
          onEditStep={handleEditStep}
          onOpenMaterials={() => navigate('upload')}
          onRequestContact={handleRequestContact}
          onSaveAndExit={handleSaveAndExit}
          phoneVerified={phoneVerified}
          {...(privacyConfiguration.productionDataEnabled && privacyConfiguration.policyUrl !== null
            ? { privacyPolicyUrl: privacyConfiguration.policyUrl }
            : {})}
          requestingContact={requestingContact}
          saveStatus={saveStatus}
          {...(saveStatusText === undefined ? {} : { saveStatusText })}
          serverBacked={runtimeStatus === 'connected'}
          step={briefStep}
        />
      );
      break;
    case 'cases':
      screen = (
        <CasesScreen
          bridge={maxBridge}
          onBack={handleBack}
          onDiscuss={handleCaseDiscuss}
          selectedCaseIds={draft.selectedCaseIds ?? []}
        />
      );
      break;
    case 'upload':
      screen = (
        <UploadScreen
          description={draft.description ?? ''}
          documentLookupAuthoritative={!shouldUseServer}
          documentIds={draft.documentIds ?? []}
          fileUploadsEnabled={!shouldUseServer || runtimeStatus === 'connected'}
          onBack={handleBack}
          onDocumentAdded={handleDocumentAdded}
          {...(shouldUseServer ? { onDocumentDownload: handleDocumentDownload } : {})}
          onDocumentRemoved={handleDocumentRemoved}
          onDescriptionChange={(description) => updateDraft({ ...draft, description })}
          onDone={() => (hasActiveDraft ? navigate('brief') : openBrief())}
          onLinkChange={(link) =>
            updateDraft({
              ...draft,
              links:
                link === ''
                  ? (draft.links ?? []).slice(1)
                  : [link, ...(draft.links ?? []).slice(1)],
            })
          }
          onToast={handleUploadToast}
          serverBacked={shouldUseServer}
          uploadApi={shouldUseServer ? serverApi : uploadApi}
          uploadLink={draft.links?.[0] ?? ''}
        />
      );
      break;
    case 'summary':
      screen =
        finalForm === null ? (
          <LoadingScreen label="Возвращаемся к незаполненному разделу…" />
        ) : (
          <SummaryScreen
            documentNames={documentNames}
            form={finalForm}
            isSubmitting={isSubmitting}
            onBack={handleBack}
            onEditStep={handleEditStep}
            onSubmit={handleSubmit}
            phoneVerified={phoneVerified}
            serverBacked={runtimeStatus === 'connected'}
            {...(submitError === undefined ? {} : { submitError })}
          />
        );
      break;
    case 'success':
      screen =
        submission === null ? (
          <LoadingScreen label="Открываем главную…" />
        ) : (
          <SuccessScreen
            onAddMaterials={() => {
              showToast(
                shouldUseServer
                  ? 'Открыт новый черновик — отправленная заявка не изменится'
                  : 'Открыт новый черновик — предыдущая preview-заявка не изменится',
                'success',
              );
              navigate('upload');
            }}
            onHome={() => navigate('home')}
            onOpenChat={handleOpenManagerChat}
            submission={submission}
          />
        );
      break;
    case 'privacy':
      screen = (
        <PrivacyScreen
          consentVersion={privacyConfiguration.consentVersion}
          onBack={handleBack}
          {...(shouldUseServer && !privacyAcknowledged
            ? {
                onContinue: () => {
                  setPrivacyAcknowledged(true);
                },
              }
            : {})}
          {...(privacyConfiguration.productionDataEnabled && privacyConfiguration.policyUrl !== null
            ? { policyUrl: privacyConfiguration.policyUrl }
            : {})}
          {...(termsUrl === null ? {} : { termsUrl })}
        />
      );
      break;
  }

  if (runtimeStatus === 'awaiting-consent') {
    screen = (
      <PrivacyScreen
        consentVersion={privacyConfiguration.consentVersion}
        onBack={() => navigate('home')}
        onContinue={() => setPrivacyAcknowledged(true)}
        {...(privacyConfiguration.policyUrl === null
          ? {}
          : { policyUrl: privacyConfiguration.policyUrl })}
        {...(termsUrl === null ? {} : { termsUrl })}
      />
    );
  } else if (runtimeStatus === 'connecting') {
    screen = <LoadingScreen label="Проверяем защищённую MAX-сессию…" />;
  } else if (runtimeStatus === 'error') {
    screen = (
      <RuntimeUnavailableScreen
        onRetry={() => {
          window.location.reload();
        }}
        onSupport={handleOpenManagerChat}
      />
    );
  } else if (
    runtimeStatus === 'connected' &&
    !privacyAcknowledged &&
    (route === 'brief' || route === 'summary' || route === 'upload')
  ) {
    screen = (
      <PrivacyScreen
        consentVersion={privacyConfiguration.consentVersion}
        onBack={() => navigate('home')}
        onContinue={() => setPrivacyAcknowledged(true)}
        {...(privacyConfiguration.policyUrl === null
          ? {}
          : { policyUrl: privacyConfiguration.policyUrl })}
        {...(termsUrl === null ? {} : { termsUrl })}
      />
    );
  }

  const showNavigation =
    runtimeStatus !== 'awaiting-consent' &&
    runtimeStatus !== 'connecting' &&
    runtimeStatus !== 'error' &&
    (route === 'home' || route === 'cases');
  const platform = maxBridge.getPlatform() === 'ios' ? 'ios' : 'android';
  const runtimeLabel =
    runtimeStatus === 'connected'
      ? 'MAX · защищённая сессия'
      : runtimeStatus === 'awaiting-consent'
        ? 'MAX · ожидается согласие'
        : runtimeStatus === 'connecting'
          ? 'MAX · подключение'
          : runtimeStatus === 'error'
            ? 'MAX · сервер недоступен'
            : maxBridge.isAvailable()
              ? 'MAX · preview'
              : 'Web preview';
  const runtimeNotice =
    runtimeStatus === 'connected'
      ? 'Этап 5 · MAX-сессия, серверный черновик и защищённое хранилище подключены'
      : runtimeStatus === 'awaiting-consent'
        ? 'До вашего согласия Mini App не отправляет MAX-профиль и данные на сервер'
        : maxBridge.isAvailable() && !privacyConfiguration.productionDataEnabled
          ? 'Без утверждённой политики персональные данные остаются только в preview-режиме'
          : runtimeStatus === 'error'
            ? 'Защищённое соединение не установлено · отправка данных заблокирована'
            : 'Web preview · демонстрационные данные не отправляются во внешние системы';

  return (
    <MaxUI colorScheme={theme} platform={platform}>
      <div className="app" data-platform={maxBridge.getPlatform()}>
        <AppTopbar
          onNavigate={handleNavigation}
          status={runtimeLabel}
          statusTone={runtimeStatusTone(runtimeStatus)}
        />
        {runtimeStatus === 'connected' ? null : (
          <div className="mock-ribbon">{runtimeNotice}</div>
        )}
        <div className="screen-shell" key={`${runtimeStatus}:${route}`}>
          {screen}
        </div>
        {showNavigation ? (
          <BottomNav activeRoute={activeNavigationRoute(route)} onNavigate={handleNavigation} />
        ) : null}
        {toast === null ? null : (
          <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
        )}
      </div>
    </MaxUI>
  );
};
