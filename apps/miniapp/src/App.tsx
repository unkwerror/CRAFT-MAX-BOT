import { MaxUI } from '@maxhub/max-ui';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  CaseCatalogItem,
  LeadDraft,
  LeadDraftFormState,
  LeadFormData,
  Submission,
} from '@craft72/contracts/source';

import { createEmptyDraft, toFinalLeadForm } from './brief/draft.js';
import { AppTopbar, BottomNav, LoadingScreen, Toast } from './components/Layout.js';
import type { ServiceRecommendation } from './domain/index.js';
import {
  createBrowserDraftStorage,
  LocalStorageDraftRepository,
  MockSessionState,
  MockSubmissionApi,
  MockUploadApi,
} from './mock/index.js';
import { getRouteFromHash, routeHref, type AppRoute } from './navigation.js';
import { maxBridge } from './platform/index.js';
import { BRIEF_TOTAL_STEPS, BriefScreen, type BriefStep } from './screens/BriefScreen.js';
import { CasesScreen } from './screens/CasesScreen.js';
import { FinderScreen } from './screens/FinderScreen.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { PrivacyScreen } from './screens/PrivacyScreen.js';
import { SuccessScreen } from './screens/SuccessScreen.js';
import { SummaryScreen } from './screens/SummaryScreen.js';
import { UploadScreen } from './screens/UploadScreen.js';

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

export const App = () => {
  const browserStorage = useMemo(() => createBrowserDraftStorage(), []);
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
  const initialSavedDraft = useMemo(() => draftRepository.load(), [draftRepository]);

  const [route, setRoute] = useState<AppRoute>(() => getRouteFromHash(window.location.hash));
  const [savedDraft, setSavedDraft] = useState<LeadDraft | null>(initialSavedDraft);
  const [draft, setDraft] = useState<LeadDraftFormState>(
    () => initialSavedDraft?.payload ?? createEmptyDraft(),
  );
  const [briefStep, setBriefStep] = useState<BriefStep>(() =>
    asBriefStep(initialSavedDraft?.currentStep ?? 1),
  );
  const [hasActiveDraft, setHasActiveDraft] = useState(initialSavedDraft !== null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [returnToSummaryAfterEdit, setReturnToSummaryAfterEdit] = useState(false);
  const [requestingContact, setRequestingContact] = useState(false);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState(() => maxBridge.getTheme());

  const navigate = useCallback((nextRoute: AppRoute): void => {
    const href = routeHref(nextRoute);
    if (window.location.hash !== href) window.location.hash = href;
    setRoute(nextRoute);
    window.scrollTo({ behavior: 'smooth', top: 0 });
  }, []);

  const persistDraft = useCallback(
    (nextDraft: LeadDraftFormState, step: BriefStep): LeadDraft => {
      const stored = draftRepository.saveAfterStep({ currentStep: step, payload: nextDraft });
      setSavedDraft(stored);
      return stored;
    },
    [draftRepository],
  );

  const updateDraft = useCallback((nextDraft: LeadDraftFormState): void => {
    setHasActiveDraft(true);
    setDraft(nextDraft);
  }, []);

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
    themeColor?.setAttribute('content', theme === 'dark' ? '#141615' : '#f3f1eb');
    return maxBridge.subscribeTheme(setTheme);
  }, [theme]);

  useEffect(() => {
    let active = true;
    void maxBridge.getViewportSize().then((viewport) => {
      if (!active) return;
      document.documentElement.style.setProperty(
        '--app-viewport-height',
        viewport.height > 0 ? `${String(viewport.height)}px` : '100dvh',
      );
      document.documentElement.style.setProperty(
        '--app-viewport-width',
        viewport.width > 0 ? `${String(viewport.width)}px` : '100vw',
      );
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (hasActiveDraft) maxBridge.enableClosingConfirmation();
    else maxBridge.disableClosingConfirmation();
    return () => maxBridge.disableClosingConfirmation();
  }, [hasActiveDraft]);

  useEffect(() => {
    if (!hasActiveDraft) return undefined;
    const timeout = window.setTimeout(() => {
      try {
        persistDraft(draft, briefStep);
      } catch {
        setToast('Не удалось сохранить черновик на этом устройстве');
      }
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [briefStep, draft, hasActiveDraft, persistDraft]);

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
    setHasActiveDraft(true);
    navigate('brief');
  }, [navigate]);

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
      await Promise.resolve();
      try {
        const cleaned = cleanDraftForValidation(nextDraft);
        setDraft(cleaned);
        setHasActiveDraft(true);
        if (returnToSummaryAfterEdit && safeFinalForm(cleaned) !== null) {
          persistDraft(cleaned, 17);
          setReturnToSummaryAfterEdit(false);
          navigate('summary');
        } else if (briefStep < BRIEF_TOTAL_STEPS) {
          const nextStep = asBriefStep(briefStep + 1);
          persistDraft(cleaned, nextStep);
          setBriefStep(nextStep);
        } else {
          persistDraft(cleaned, 17);
          setReturnToSummaryAfterEdit(false);
          navigate('summary');
        }
      } finally {
        setIsSaving(false);
      }
    },
    [briefStep, navigate, persistDraft, returnToSummaryAfterEdit],
  );

  const handleSaveAndExit = useCallback(
    async (nextDraft: LeadDraftFormState): Promise<void> => {
      setIsSaving(true);
      await Promise.resolve();
      try {
        const cleaned = cleanDraftForValidation(nextDraft);
        setDraft(cleaned);
        setHasActiveDraft(true);
        persistDraft(cleaned, briefStep);
        setReturnToSummaryAfterEdit(false);
        setToast('Черновик сохранён');
        navigate('home');
      } finally {
        setIsSaving(false);
      }
    },
    [briefStep, navigate, persistDraft],
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
      const phone = contact.phone.startsWith('+') ? contact.phone : `+${contact.phone}`;
      session.setVerifiedContact({ phone, verifiedAt: new Date().toISOString() });
      setDraft((current) => ({
        ...current,
        contact: { ...current.contact, phone },
      }));
      setHasActiveDraft(true);
      setToast('Контакт получен из MAX');
    } catch {
      setToast('MAX не передал контакт — введите номер вручную');
    } finally {
      setRequestingContact(false);
    }
  }, [session]);

  const handleFinderDiscuss = useCallback(
    (recommendations: readonly ServiceRecommendation[]): void => {
      const services = [
        ...new Set([...(draft.services ?? []), ...recommendations.map((item) => item.service)]),
      ];
      updateDraft({ ...draft, services });
      setToast('Направления добавлены в бриф');
      openBrief();
    },
    [draft, openBrief, updateDraft],
  );

  const handleCaseDiscuss = useCallback(
    (item: CaseCatalogItem): void => {
      if (draft.selectedCaseIds?.includes(item.id) === true) {
        updateDraft({
          ...draft,
          selectedCaseIds: draft.selectedCaseIds.filter((caseId) => caseId !== item.id),
        });
        setToast('Проект убран из брифа');
        return;
      }
      const selectedCaseIds = [...new Set([...(draft.selectedCaseIds ?? []), item.id])];
      updateDraft({ ...draft, selectedCaseIds });
      setToast('Проект добавлен в бриф');
      openBrief();
    },
    [draft, openBrief, updateDraft],
  );

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

  const finalForm = useMemo(() => safeFinalForm(draft), [draft]);
  const phoneVerified = session.verifiedContact?.phone === draft.contact?.phone;
  const documentNames = useMemo(
    () =>
      (draft.documentIds ?? []).flatMap((documentId) => {
        try {
          const document = uploadApi.getDocument(documentId);
          return document === null ? [] : [document.originalName];
        } catch {
          return [];
        }
      }),
    [draft.documentIds, uploadApi],
  );

  const handleSubmit = useCallback(async (): Promise<void> => {
    const form = safeFinalForm(draft);
    if (form === null) {
      setSubmitError('Проверьте обязательные поля брифа. Введённые данные сохранены.');
      return;
    }

    setSubmitError(undefined);
    setIsSubmitting(true);
    await Promise.resolve();
    try {
      const stored = persistDraft(cleanDraftForValidation(draft), 17);
      const response = submissionApi.createSubmission({
        draftId: stored.id,
        idempotencyKey: `stage2-${stored.id}`,
        payload: form,
      });
      setSubmission(response.submission);
      draftRepository.clear();
      setSavedDraft(null);
      setHasActiveDraft(false);
      setDraft(createEmptyDraft());
      setBriefStep(1);
      navigate('success');
    } catch {
      setSubmitError(
        'Mock API не принял заявку. Проверьте материалы или поля и повторите отправку.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [draft, draftRepository, navigate, persistDraft, submissionApi]);

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
          onSupport={() => setToast('Чат с менеджером будет подключён на этапе настройки MAX-бота')}
        />
      );
      break;
    case 'finder':
      screen = <FinderScreen onBack={handleBack} onDiscuss={handleFinderDiscuss} />;
      break;
    case 'brief':
      screen = (
        <BriefScreen
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
          requestingContact={requestingContact}
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
          documentIds={draft.documentIds ?? []}
          onBack={handleBack}
          onDocumentAdded={handleDocumentAdded}
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
          onToast={setToast}
          uploadApi={uploadApi}
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
              setToast('Открыт новый черновик — предыдущая mock-заявка не изменится');
              navigate('upload');
            }}
            onHome={() => navigate('home')}
            onOpenChat={() =>
              setToast('Чат с менеджером будет подключён на этапе настройки MAX-бота')
            }
            submission={submission}
          />
        );
      break;
    case 'privacy':
      screen = <PrivacyScreen onBack={handleBack} />;
      break;
  }

  const showNavigation = route === 'home' || route === 'cases';
  const platform = maxBridge.getPlatform() === 'ios' ? 'ios' : 'android';

  return (
    <MaxUI colorScheme={theme} platform={platform}>
      <div className="app" data-platform={maxBridge.getPlatform()}>
        <AppTopbar
          onNavigate={handleNavigation}
          status={maxBridge.isAvailable() ? 'MAX Mini App' : 'Web preview'}
        />
        <div className="mock-ribbon">
          Этап 2 · интерфейс работает на демонстрационных данных, без отправки во внешние системы
        </div>
        {screen}
        {showNavigation ? (
          <BottomNav activeRoute={activeNavigationRoute(route)} onNavigate={handleNavigation} />
        ) : null}
        {toast === null ? null : <Toast message={toast} onClose={() => setToast(null)} />}
      </div>
    </MaxUI>
  );
};
