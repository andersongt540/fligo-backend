const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

function estadoSuscripcion({ prueba_hasta, suscripcion_hasta }, now = new Date()) {
  const trialEnd = prueba_hasta ? new Date(prueba_hasta) : null;
  const subscriptionEnd = suscripcion_hasta ? new Date(suscripcion_hasta) : null;
  const paidActive = subscriptionEnd && subscriptionEnd > now;
  const trialActive = trialEnd && trialEnd > now;
  const fechaHasta = paidActive ? subscriptionEnd : trialActive ? trialEnd : null;

  return {
    estado: paidActive ? 'ACTIVA' : trialActive ? 'PRUEBA' : 'VENCIDA',
    dias_restantes: fechaHasta
      ? Math.max(0, Math.ceil((fechaHasta.getTime() - now.getTime()) / DAY_IN_MILLISECONDS))
      : 0,
    prueba_hasta: prueba_hasta || null,
    suscripcion_hasta: suscripcion_hasta || null
  };
}

module.exports = { estadoSuscripcion };
