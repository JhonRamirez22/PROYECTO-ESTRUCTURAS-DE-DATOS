export interface CustomerNotificationChannelStatus {
  configured: boolean;
  pending: number;
  retrying: number;
  processing: number;
  failed: number;
}

export interface CustomerNotificationOperationsStatus {
  channels: {
    email: CustomerNotificationChannelStatus;
    sms: CustomerNotificationChannelStatus;
  };
  workerRunning?: boolean;
  warning: string | null;
}

const CHANNEL_SETUP = {
  email: {
    variables: [
      { name: 'NOTIFICATION_SMTP_HOST', note: 'Servidor de correo' },
      { name: 'NOTIFICATION_SMTP_PORT', note: '587 por defecto; 465 también funciona' },
      { name: 'NOTIFICATION_FROM_EMAIL', note: 'Dirección remitente' },
      { name: 'NOTIFICATION_SMTP_USERNAME', note: 'Usuario SMTP, si el servidor lo requiere' },
      { name: 'NOTIFICATION_SMTP_PASSWORD', note: 'Contraseña SMTP; debe ir junto al usuario' },
    ],
  },
  sms: {
    variables: [
      { name: 'NOTIFICATION_SMS_TWILIO_ACCOUNT_SID', note: 'Identificador de la cuenta' },
      { name: 'NOTIFICATION_SMS_TWILIO_AUTH_TOKEN', note: 'Token privado de Twilio' },
      { name: 'NOTIFICATION_SMS_TWILIO_FROM_PHONE', note: 'Número remitente en formato internacional' },
    ],
  },
} as const;

export function isCustomerNotificationOperationsStatus(
  value: unknown
): value is CustomerNotificationOperationsStatus {
  if (typeof value !== 'object' || value === null || !('channels' in value)) return false;
  const candidate = value as Partial<CustomerNotificationOperationsStatus>;
  const isChannel = (channel: unknown): channel is CustomerNotificationChannelStatus => {
    if (typeof channel !== 'object' || channel === null || !('configured' in channel)) return false;
    const counts = channel as Partial<CustomerNotificationChannelStatus>;
    return (
      typeof counts.configured === 'boolean' &&
      ['pending', 'retrying', 'processing', 'failed'].every((key) => {
        const count = counts[key as keyof CustomerNotificationChannelStatus];
        return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
      })
    );
  };

  const channels = candidate.channels;
  return (
    typeof channels === 'object' &&
    channels !== null &&
    isChannel(channels.email) &&
    isChannel(channels.sms) &&
    (candidate.workerRunning === undefined || typeof candidate.workerRunning === 'boolean') &&
    (candidate.warning === null || typeof candidate.warning === 'string')
  );
}

export default function CustomerNotificationReadiness({
  status,
  unavailable,
}: {
  status: CustomerNotificationOperationsStatus | null;
  unavailable: boolean;
}) {
  const channels = status?.channels;
  const configuredCount = [channels?.email, channels?.sms].filter(
    (channel) => channel?.configured
  ).length;
  const workerRunning = status?.workerRunning === true;
  const automaticRetriesReady = configuredCount > 0 && workerRunning;
  const failedCount = (channels?.email?.failed ?? 0) + (channels?.sms?.failed ?? 0);
  const warning = status?.warning ?? (
    configuredCount > 0 && !workerRunning
      ? 'Los avisos nuevos se intentan enviar al asignar la ruta o registrar el GPS; si uno falla, no habrá reintento automático mientras el worker esté apagado.'
      : failedCount > 0
        ? `${failedCount} aviso${failedCount === 1 ? '' : 's'} requiere revisión del administrador.`
        : null
  );
  const statusLabel = unavailable
    ? 'Estado no actualizado'
    : failedCount > 0
      ? 'Revisar avisos fallidos'
      : configuredCount === 0
        ? 'Configurar canal'
        : workerRunning
          ? 'Reintentos automáticos activos'
          : 'Reintentos automáticos apagados';

  return (
    <section
      aria-label="Estado de avisos a clientes"
      className="mb-6 scroll-mt-32 rounded-2xl border border-slate-200 bg-white px-5 py-4"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Avisos al cliente</h2>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">
            Al consentir un canal, se encolan avisos al asignar la ruta y cuando el GPS detecta
            cercanía al destino. El intento inicial requiere que ese canal esté configurado; un
            worker persistente permite reintentar automáticamente si el proveedor falla.
          </p>
        </div>
        {status ? (
          <span
            className={`mt-1 inline-flex shrink-0 items-center gap-2 text-xs font-semibold ${failedCount > 0 || !automaticRetriesReady || unavailable ? 'text-amber-800' : 'text-emerald-800'}`}
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${failedCount > 0 || !automaticRetriesReady || unavailable ? 'bg-amber-500' : 'bg-emerald-600'}`}
            />
            {statusLabel}
          </span>
        ) : null}
      </div>

      {unavailable ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-900" role="status">
          No se pudo verificar la cola de avisos. El despacho y el seguimiento siguen disponibles.
        </p>
      ) : null}

      {!status && !unavailable ? (
        <p className="mt-3 text-sm text-slate-600" role="status">
          Consultando configuración de correo y SMS…
        </p>
      ) : null}
      {status ? (
        <>
          {unavailable ? (
            <p className="mt-2 text-xs text-slate-500">Se muestra el último estado recibido.</p>
          ) : null}
          <div className="mt-4 grid gap-x-8 sm:grid-cols-2">
            <NotificationChannelRow
              channel="email"
              label="Correo electrónico"
              status={status.channels.email}
            />
            <NotificationChannelRow channel="sms" label="SMS" status={status.channels.sms} />
          </div>
          {warning ? (
            <p className="mt-3 text-xs leading-5 text-amber-900" role="status">
              {warning}
            </p>
          ) : null}
          <p className="mt-2 text-xs leading-5 text-slate-500">
            «Configurado» confirma que las variables requeridas están presentes; el proveedor confirma cada envío por separado.
          </p>
        </>
      ) : null}
    </section>
  );
}

function NotificationChannelRow({
  channel,
  label,
  status,
}: {
  channel: keyof typeof CHANNEL_SETUP;
  label: string;
  status: CustomerNotificationChannelStatus;
}) {
  return (
    <div className="border-t border-slate-200 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-slate-800">{label}</h3>
        <span className={`text-xs font-semibold ${status.configured ? 'text-emerald-800' : 'text-slate-600'}`}>
          {status.configured ? 'Configurado' : 'Sin configurar'}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-slate-600">En cola</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{status.pending}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Reintentos</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{status.retrying}</dd>
        </div>
        <div>
          <dt className="text-slate-600">En proceso</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{status.processing}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Agotados</dt>
          <dd className={`mt-0.5 font-semibold tabular-nums ${status.failed > 0 ? 'text-rose-700' : 'text-slate-900'}`}>
            {status.failed}
          </dd>
        </div>
      </dl>
      {!status.configured ? (
        <details className="mt-3 text-xs text-slate-700">
          <summary className="min-h-11 cursor-pointer py-3 font-semibold text-emerald-900 underline decoration-emerald-700/40 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
            Cómo configurar {label}
          </summary>
          <div className="pb-2 leading-5">
            <p>
              Configura estas variables en el entorno privado del backend y vuelve a desplegar.
              No ingreses sus valores en esta aplicación ni en el chat.
            </p>
            <ul className="mt-2 space-y-2">
              {CHANNEL_SETUP[channel].variables.map(({ name, note }) => (
                <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" key={name}>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-800">
                    {name}
                  </code>
                  <span className="text-slate-600">{note}</span>
                </li>
              ))}
            </ul>
            {channel === 'email' ? (
              <p className="mt-2 text-slate-600">
                Si tu SMTP usa autenticación, configura usuario y contraseña juntos.
              </p>
            ) : (
              <p className="mt-2 text-slate-600">
                El número remitente debe incluir el prefijo del país, por ejemplo +57.
              </p>
            )}
          </div>
        </details>
      ) : null}
    </div>
  );
}
