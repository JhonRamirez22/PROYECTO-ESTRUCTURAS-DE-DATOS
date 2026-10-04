'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

interface CustomerOrderChatProps {
  guide: string;
}

interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
}

type AssistantConfiguration = 'checking' | 'configured' | 'not-configured' | 'unknown';

const MAX_MESSAGE_LENGTH = 700;
const AVAILABILITY_TIMEOUT_MS = 5_000;
// Four user turns remain below the API's 3,000-character conversation limit.
const MAX_HISTORY_TURNS = 4;
const SUGGESTED_QUESTIONS = ['¿Ya fue asignado?', '¿Ya viene?', '¿Cuánto falta?'];
const PROVIDER_NOTICE_SUMMARY =
  'A la IA solo se envían la intención normalizada y el estado del pedido; el ETA se comparte si lo preguntas y es aproximado. Ver privacidad y tráfico.';
const DEFAULT_PROVIDER_NOTICE =
  'Privacidad: la IA recibe solo la intención normalizada y el estado; el texto original no se comparte. ' +
  'No se envían guía, dirección, coordenadas, nombre, teléfono ni IDs. ' +
  'Si preguntas por la llegada, el ETA es aproximado; TomTom, si está disponible, solo cubre ' +
  'parte del primer tramo, no toda la ruta. El chat se limita a este pedido.';

export default function CustomerOrderChat({ guide }: CustomerOrderChatProps) {
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [assistantConfiguration, setAssistantConfiguration] =
    useState<AssistantConfiguration>('checking');
  const [error, setError] = useState<string | null>(null);
  const [providerNotice, setProviderNotice] = useState(DEFAULT_PROVIDER_NOTICE);
  const conversationRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT_MS);

    void fetch('/api/cliente/chat/estado', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('No se pudo comprobar el asistente.');
        }
        const payload: unknown = await response.json();
        if (!isAssistantConfiguration(payload)) {
          throw new Error('La configuración del asistente no tiene un formato válido.');
        }
        if (active) {
          setAssistantConfiguration(payload.configured ? 'configured' : 'not-configured');
        }
      })
      .catch(() => {
        if (active) {
          // Si falla la consulta de estado, permitimos probar el chat y mostramos el error real.
          setAssistantConfiguration('unknown');
        }
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const viewport = conversationRef.current;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [conversation, submitting]);

  const sendQuestion = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || submitting) {
      return;
    }

    const nextConversation = [...conversation, { role: 'user' as const, content: question }];
    setConversation(nextConversation);
    setDraft('');
    setError(null);
    setSubmitting(true);

    try {
      const messages = nextConversation
        .filter((message) => message.role === 'user')
        .slice(-MAX_HISTORY_TURNS)
        .map((message) => ({ role: 'user' as const, content: message.content }));
      const response = await fetch('/api/cliente/chat', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guide, messages }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload: unknown = await response.json();
      if (!isChatResponse(payload)) {
        throw new Error('El asistente devolvió una respuesta inválida. Inténtalo de nuevo.');
      }

      setConversation((current) => [...current, { role: 'assistant', content: payload.reply }]);
      if (payload.providerNotice) {
        setProviderNotice(payload.providerNotice);
      }
    } catch (sendError) {
      setConversation(conversation);
      setDraft((currentDraft) => currentDraft || question);
      setError(
        sendError instanceof Error
          ? sendError.message
          : 'No se pudo enviar la pregunta. Comprueba tu conexión e inténtalo de nuevo.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const selectSuggestedQuestion = (question: string): void => {
    setDraft(question);
    questionRef.current?.focus();
  };

  return (
    <section
      aria-labelledby="customer-order-chat-title"
      className="lg:col-span-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.06)]"
    >
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900" id="customer-order-chat-title">
            ¿Tienes dudas sobre este pedido?
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Resuelve dudas sobre esta guía. La conexión con el proveedor se confirma al enviar.
          </p>
        </div>
        <span
          className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
            assistantConfiguration === 'configured'
              ? 'bg-emerald-50 text-emerald-800'
              : assistantConfiguration === 'checking'
                ? 'bg-slate-100 text-slate-700'
                : 'bg-amber-50 text-amber-900'
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              assistantConfiguration === 'configured' ? 'bg-emerald-600' : 'bg-amber-600'
            }`}
          />
          {assistantConfiguration === 'configured'
            ? 'IA configurada'
            : assistantConfiguration === 'checking'
              ? 'Verificando configuración'
              : assistantConfiguration === 'unknown'
                ? 'Configuración sin confirmar'
                : 'IA sin configurar'}
        </span>
      </div>

      {assistantConfiguration === 'not-configured' ? (
        <p className="px-4 py-5 text-sm leading-6 text-slate-700 sm:px-5" role="status">
          El asistente no está configurado por ahora. Puedes seguir consultando el estado del pedido
          y su ubicación con esta misma guía.
        </p>
      ) : assistantConfiguration === 'checking' ? (
        <p className="px-4 py-5 text-sm text-slate-600 sm:px-5" role="status">
          Comprobando la configuración del asistente…
        </p>
      ) : (
        <>
          <div
            aria-label="Conversación sobre el pedido"
            aria-live="polite"
            className="max-h-72 min-h-32 space-y-3 overflow-y-auto px-4 py-4 sm:px-5"
            ref={conversationRef}
            role="log"
          >
            {conversation.length === 0 ? (
              <div className="flex min-h-24 flex-col justify-center gap-3">
                <p className="text-sm text-slate-600">Puedes preguntar, por ejemplo:</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_QUESTIONS.map((question) => (
                    <button
                      className="min-h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-emerald-950 transition-colors hover:border-emerald-300 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50"
                      disabled={submitting}
                      key={question}
                      onClick={() => selectSuggestedQuestion(question)}
                      type="button"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              conversation.map((message, index) => (
                <div
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  key={`${message.role}-${index}`}
                >
                  <p
                    className={`max-w-[min(90%,42rem)] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${
                      message.role === 'user'
                        ? 'rounded-br-md bg-[#122522] text-white'
                        : 'rounded-bl-md border border-slate-200 bg-slate-50 text-slate-800'
                    }`}
                  >
                    {message.content}
                  </p>
                </div>
              ))
            )}
            {submitting ? (
              <p className="text-sm text-slate-600" role="status">
                Consultando el estado de tu pedido…
              </p>
            ) : null}
          </div>

          <div className="border-t border-slate-100 px-4 py-4 sm:px-5">
            <details className="mb-3 rounded-xl bg-slate-50 px-3 text-xs text-slate-600">
              <summary className="min-h-11 cursor-pointer py-3 font-medium leading-5 text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
                {PROVIDER_NOTICE_SUMMARY}
              </summary>
              <p className="pb-3 leading-5">{providerNotice}</p>
            </details>
            {assistantConfiguration === 'unknown' ? (
              <p className="mb-3 text-sm leading-5 text-amber-900" role="status">
                No pudimos confirmar si el asistente está configurado. Puedes intentar enviar tu pregunta.
              </p>
            ) : null}
            {error ? (
              <p
                className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-5 text-amber-950"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => void sendQuestion(event)}
            >
              <label className="sr-only" htmlFor="customer-order-question">
                Escribe tu pregunta sobre el pedido
              </label>
              <input
                autoComplete="off"
                className="rp-input min-h-11 flex-1 px-3 py-2.5 text-sm"
                id="customer-order-question"
                maxLength={MAX_MESSAGE_LENGTH}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ej. ¿Ya fue asignado a una ruta?"
                ref={questionRef}
                value={draft}
              />
              <button
                className="rp-button rp-button-primary min-w-28 disabled:opacity-60"
                disabled={!draft.trim() || submitting}
                type="submit"
              >
                {submitting ? 'Enviando…' : 'Preguntar'}
              </button>
            </form>
            <p className="mt-2 text-right text-xs text-slate-500">
              {draft.length}/{MAX_MESSAGE_LENGTH}
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function isAssistantConfiguration(value: unknown): value is { configured: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'configured' in value &&
    typeof value.configured === 'boolean'
  );
}

function isChatResponse(value: unknown): value is { reply: string; providerNotice?: string } {
  if (typeof value !== 'object' || value === null || !('reply' in value)) {
    return false;
  }
  const response = value as { reply?: unknown; providerNotice?: unknown };
  return (
    typeof response.reply === 'string' &&
    response.reply.trim().length > 0 &&
    (response.providerNotice === undefined || typeof response.providerNotice === 'string')
  );
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (typeof payload === 'object' && payload !== null && 'error' in payload) {
      const message = (payload as { error?: unknown }).error;
      if (typeof message === 'string') {
        return message;
      }
    }
  } catch {
    // El mensaje de recuperación no depende de que el backend devuelva JSON.
  }
  return 'El asistente no está disponible ahora. Puedes actualizar el seguimiento e intentarlo luego.';
}
