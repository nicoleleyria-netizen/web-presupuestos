// app.js
document.addEventListener("DOMContentLoaded", () => {
  try {
    bootstrap();
  } catch (e) {
    const doc = document.getElementById("doc");
    if (doc) doc.innerHTML = `<div class="text-red-600 p-4">Error inicializando: ${e.message}</div>`;
    console.error(e);
  }
});

function bootstrap() {
  const STORAGE_KEY = "presupuestosHistorialV1";
  const REMOTE_BACKEND_URL = String(window.PRESUPUESTOS_BACKEND_URL || "").trim();
  const USE_REMOTE_BACKEND = !!REMOTE_BACKEND_URL;

  // ========== Utils ==========
  const todayISO = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const formatDateLong = (iso) => {
    let d;
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      // Parseo LOCAL para evitar el -1 día
      const [y, m, dd] = iso.split("-").map(Number);
      d = new Date(y, m - 1, dd);
    } else {
      d = iso ? new Date(iso) : new Date();
    }
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("es-AR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/Argentina/Cordoba"
    });
  };

  const formatCurrency = (num, currency = "ARS") =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(isNaN(+num) ? 0 : +num);

  const safeFilename = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, "").trim();
  const safeFilenameStrict = (s) => {
    const ascii = removeDiacritics(String(s || ""));
    const cleaned = ascii
      .replace(/[^A-Za-z0-9 _.,()-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned || "archivo";
  };
  const removeDiacritics = (str) => String(str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const upperNoDiacritics = (s) => removeDiacritics(s).toUpperCase();
  const createRecordId = () => {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  function jsonpRequest(url, params = {}, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const callbackName = `jsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const query = new URLSearchParams();

      query.set("callback", callbackName);
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        query.set(key, typeof value === "string" ? value : JSON.stringify(value));
      });

      let timer = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      window[callbackName] = (payload) => {
        cleanup();
        resolve(payload);
      };

      script.onerror = () => {
        cleanup();
        reject(new Error("No se pudo conectar con el backend de Google Sheets"));
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error("Tiempo de espera agotado al contactar el backend"));
      }, timeoutMs);

      script.src = `${url}${url.includes("?") ? "&" : "?"}${query.toString()}`;
      document.head.appendChild(script);
    });
  }

  const remoteApi = USE_REMOTE_BACKEND
    ? {
        list: () => jsonpRequest(REMOTE_BACKEND_URL, { action: "list" }),
        create: (record) => jsonpRequest(REMOTE_BACKEND_URL, { action: "create", record }),
        toggle: (id) => jsonpRequest(REMOTE_BACKEND_URL, { action: "toggle", id }),
        remove: (id) => jsonpRequest(REMOTE_BACKEND_URL, { action: "delete", id }),
        clear: () => jsonpRequest(REMOTE_BACKEND_URL, { action: "clear" }),
      }
    : null;

  function normalizeRecord(record, index = 0) {
    const safeRecord = record && typeof record === "object" ? record : {};
    return {
      ...safeRecord,
      id: safeRecord.id || `${safeRecord.createdAt || Date.now()}-${index}-${createRecordId()}`,
      source: safeRecord.source || "pdf",
      createdAt: safeRecord.createdAt || new Date().toISOString(),
      fechaPresupuesto: safeRecord.fechaPresupuesto || "",
      comitente: safeRecord.comitente || "Sin nombre",
      trabajo: safeRecord.trabajo || "—",
      ubicacion: safeRecord.ubicacion || "",
      moneda: safeRecord.moneda || "ARS",
      total: Number(safeRecord.total) || 0,
      approved: safeRecord.approved === true,
    };
  }

  function readLocalRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.map((record, index) => normalizeRecord(record, index));
    } catch {
      return [];
    }
  }

  function saveLocalRecords(records) {
    const normalized = Array.isArray(records)
      ? records.map((record, index) => normalizeRecord(record, index))
      : [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  // URL de logo: si escriben una ruta Windows con \, la normalizo; si ponen LOGO.jpg (misma carpeta) lo dejo.
  const normalizeLogoUrl = (raw) => {
    if (!raw) return "";
    let s = String(raw).trim().replace(/"/g, "");
    if (/^[A-Za-z]:\\/.test(s)) s = "file:///" + s.replace(/\\/g, "/");
    return s;
  };

  // ========== Plantillas ==========
  const TEMPLATES = {
    mensuraPosesion: {
      name: "Mensura de Posesión",
      description:
        "La Mensura de Posesión permite identificar de forma fehaciente qué derechos de propiedad o parte de derechos se ven afectados por la posesión. " +
        "En el plano de mensura de posesión constan la ubicación, las medidas lineales, angulares y de superficie del polígono sobre el cual se ejerce el derecho de posesión en {{lugar}}.",
      alcance: [
        "Investigación completa de títulos, antecedentes registrales y catastrales.",
        "Planificación de la campaña, medición, determinación de ocupación actual y materialización en el lote.",
        "Cálculo y confección del plano de mensura de posesión.",
      ],
    },
    amojonamiento: {
      name: "Amojonamiento",
      description:
        "Materialización de los límites de una parcela con mojones. Compilación de antecedentes cartográficos, catastrales y de títulos para contrastarlos con los hechos existentes a fin de determinar la ubicación correcta de la parcela en {{lugar}}. " +
        "Se entrega plano de amojonamiento con medidas dentro de la manzana.",
      alcance: [
        "Investigación y análisis de antecedentes dominiales y cartográficos.",
        "Planificación de la campaña y medición completa.",
        "Colocación de mojones en vértices.",
        "Confección del plano.",
      ],
    },
    relevamientoTopo: {
      name: "Relevamiento Topográfico",
      description:
        "Relevamiento planialtimétrico con estación total/GNSS, curvas de nivel y entrega de archivo CAD/DWG en {{lugar}}.",
      alcance: [
        "Medición precisa de cotas y desniveles del terreno y calle.",
        "Curvas de nivel y archivo CAD/DWG.",
        "Informe con referencias y tolerancias.",
      ],
    },
    mensuraSubdiv: {
      name: "Mensura y Subdivisión",
      description:
        "División del inmueble en {{lugar}} conforme normativa. Tareas de relevamiento de campo, cálculo, materialización de mojones y confección del plano de mensura y subdivisión.",
      alcance: [
        "Relevamiento de campo.",
        "Materialización de limites con mojones.",
        "Plano de mensura y subdivisión.",
        
      ],
      etapas: [
        {
          titulo: "1) Mensura y subdivisión.",
          items: [
            "Investigación y análisis de antecedentes dominiales y cartográficos.",
            "Planificación de la campaña y medición completa.",
            "Confección de plano de mensura y subdivisión.",
          ],
        },
        {
          titulo: "2) Visado en Colegio Profesional",
          items: ["Visado del plano ante el Colegio de Ingenieros."],
        },
        {
          titulo: "3) Presentación Municipal",
          items: [
            "Presentación del plano en el Municipio y visado.Lo realiza el cliente",
            "Tasas municipales y presentación: a cargo del comitente.",
          ],
        },
        {
          titulo: "4)Presentación del plano en Catastro",
          items: [
            "Presentación del plano en Catastro (al inicio del trámite).",
            "Una vez aprobado se generan los numero de cuenta individuales para cada lote.",
          ],
        },
      ],
    },
    bep: {
      name: "BEP – Verificación de Estado Parcelario",
      description:
        "Verificación del estado parcelario del inmueble en {{lugar}}: investigación de títulos, relevamiento y análisis comparativo con planos vigentes. Emisión de informe/constancia correspondiente.",
      alcance: [
        "Análisis de antecedentes y normativa.",
        "Relevamiento y verificación de medidas.",
        "Informe/constancia de BEP (tasas no incluidas).",
      ],
      
    },
    usucapion: {
      name: "Usucapión",
      description:
        "Mensura y documentación técnica de apoyo a la acción judicial de prescripción adquisitiva (usucapión) en {{lugar}}. " +
        "Incluye la mensura de posesión para identificar con precisión los derechos de propiedad afectados (ubicación y medidas lineales, angulares y de superficie del polígono sobre el cual se ejerce el derecho de posesión), " +
        "la confección del plano de mensura correspondiente y gestiones técnicas ante los organismos que correspondan.",
      alcance: [
        "Mensura de posesión: investigación de antecedentes dominiales/catastrales; planificación de campaña y medición en campo; cálculo y confección del plano de mensura.",
      ],
      etapas: [
        {
          titulo: "1) Mensura de Posesión",
          items: [
            "Investigación y análisis de antecedentes dominiales y cartográficos.",
            "Planificación de la campaña y medición completa.",
            "Confección de plano de mensura de posesión.",
          ],
        },
        {
          titulo: "2) Visado en Colegio Profesional",
          items: ["Visado del plano ante el Colegio de Ingenieros."],
        },
        {
          titulo: "3) Presentación Municipal",
          items: [
            "Presentación del plano en el Municipio y visado.",
            "Tasas municipales y presentación: a cargo del comitente.",
          ],
        },
        {
          titulo: "4) Con intervención letrada",
          items: [
            "Presentación del plano en Catastro (al inicio del trámite).",
            "Nota de rogación a cargo del cliente/escribano.",
          ],
        },
      ],
    },
    // "Otro" se arma dinámicamente con el nombre que ingrese el usuario
    otro: {
      name: "Trabajo personalizado",
      description:
        "Servicio profesional de agrimensura en {{lugar}}, según detalle acordado con el comitente.",
      alcance: [],
    },
  };

  // ========== Estado y refs ==========
  const state = {
    empresa: {
      razon: byId("empRazon"),
      profesional: byId("empProfesional"),
      cuit: byId("empCuit"),
      dom: byId("empDom"),
      email: byId("empEmail"),
      tel: byId("empTel"),
      logo: byId("empLogo"),
      logoFile: byId("empLogoFile"),
      leyenda: byId("empLeyenda"),
    },
    fecha: byId("fecha"),
    modelo: byId("modelo"),
    modeloCustom: byId("modeloCustom"),
    wrapCustom: byId("wrapCustom"),
    comitente: byId("comitente"),
    telefono: byId("telefono"),
    email: byId("email"),        // <- ahora es "N° de Cuenta" en el HTML, pero mantenemos el id
    ubicacion: byId("ubicacion"),
    moneda: byId("moneda"),
    monto: byId("monto"),
    montoHint: byId("montoHint"),
    plazo: byId("plazo"),
    validez: byId("validez"),
    observaciones: byId("observaciones"),
    textoModelo: byId("textoModelo"),
    // Pago / hitos / cuotas
    pago: {
      modoAvance: byId("pagoModoAvance"),
      modoCuotas: byId("pagoModoCuotas"),
      pagoAvance: byId("pagoAvance"),
      pagoCuotas: byId("pagoCuotas"),
      hitosContainer: byId("hitosContainer"),
      btnAddHito: byId("btnAddHito"),
      sumaHitos: byId("sumaHitos"),
      cuotasCant: byId("cuotasCant"),
      cuotasInfo: byId("cuotasInfo"),
    },
    // Visado
    visado: {
      chk: byId("chkVisado"),
      monto: byId("montoVisado"),
    },
    // UI
    doc: byId("doc"),
    btnDescargar: byId("btnDescargar"),
    btnDoc: byId("btnDoc"),
    dashboard: {
      totalARS: byId("dashTotalARS"),
      totalUSD: byId("dashTotalUSD"),
      cantidad: byId("dashCantidad"),
      mes: byId("dashMes"),
      promedio: byId("dashPromedio"),
      rows: byId("dashRows"),
      btnLimpiar: byId("btnLimpiarDashboard"),
    },
  };

  let logoDataURL = ""; // si se sube archivo

  function byId(id) {
    return document.getElementById(id);
  }

  // ========== Init ==========
  function initDefaults() {
    // Fecha por defecto
    if (!state.fecha.value) state.fecha.value = todayISO();

    // Pago: crea 2 hitos base y listeners
    setupPago();

    // Mostrar input personalizado si el modelo es "otro"
    toggleCustomName();

    // Render inicial
    updateAll();
    void updateDashboard();
  }
  initDefaults();

  if (state.dashboard.btnLimpiar) {
    state.dashboard.btnLimpiar.addEventListener("click", async () => {
      const ok = window.confirm("Esto eliminará el historial de cotizaciones registradas. ¿Continuar?");
      if (!ok) return;
      if (USE_REMOTE_BACKEND) {
        await remoteApi.clear();
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
      await updateDashboard();
    });
  }

  if (state.dashboard.rows) {
    state.dashboard.rows.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action][data-id]");
      if (!button) return;

      const { action, id } = button.dataset;
      if (!action || !id) return;

      if (action === "toggle-approve") {
        void toggleRecordApproved(id);
      } else if (action === "delete") {
        void deleteRecord(id);
      }
    });
  }

  // Logo desde archivo -> dataURL
  if (state.empresa.logoFile) {
    state.empresa.logoFile.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const fr = new FileReader();
      fr.onload = () => {
        logoDataURL = String(fr.result);
        state.empresa.logo.value = ""; // prioriza archivo
        updatePreview();
      };
      fr.readAsDataURL(file);
    });
  }

  // ========== Pago (hitos/cuotas) ==========
  function addHito(desc = "", monto = "") {
    const row = document.createElement("div");
    row.className = "hito-row grid grid-cols-12 gap-2";
    row.innerHTML = `
      <input class="col-span-7 rounded-xl border p-2" placeholder="Descripción del hito" value="${desc}">
      <input class="col-span-4 rounded-xl border p-2" placeholder="Ej: 250000" type="number" step="0.01" value="${monto}">
      <button type="button" class="col-span-1 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-700">✕</button>
    `;
    state.pago.hitosContainer.appendChild(row);

    const [descInput, montoInput, btn] = row.children;
    const onChange = () => updatePagoUI();
    descInput.addEventListener("input", onChange);
    montoInput.addEventListener("input", onChange);
    btn.addEventListener("click", () => {
      row.remove();
      updatePagoUI();
    });
  }

  function getHitos() {
    const rows = state.pago.hitosContainer.querySelectorAll(".hito-row");
    const arr = [];
    rows.forEach((r) => {
      const d = r.children[0].value.trim();
      const m = parseFloat(String(r.children[1].value).replace(/,/g, ".")) || 0;
      if (d || m) arr.push({ d, m });
    });
    return arr;
  }

  function sumHitos() {
    return getHitos().reduce((acc, h) => acc + (h.m || 0), 0);
  }

  function setupPago() {
    // Dos hitos iniciales
    addHito("Día de medición", "");
    addHito("Contra entrega de plano", "");
    // Listeners
    state.pago.btnAddHito.addEventListener("click", () => addHito());
    state.pago.modoAvance.addEventListener("change", togglePagoModo);
    state.pago.modoCuotas.addEventListener("change", togglePagoModo);
    state.pago.cuotasCant.addEventListener("input", updatePagoUI);
    // Visado
    state.visado.chk.addEventListener("change", () => {
      state.visado.monto.disabled = !state.visado.chk.checked;
      updateAll();
    });
    state.visado.monto.addEventListener("input", updateAll);
  }

  function togglePagoModo() {
    const avance = state.pago.modoAvance.checked;
    state.pago.pagoAvance.classList.toggle("hidden", !avance);
    state.pago.pagoCuotas.classList.toggle("hidden", avance);
    updatePagoUI();
  }

  function visadoSeleccionado() {
    return !!state.visado.chk.checked;
  }
  function visadoMonto() {
    return visadoSeleccionado()
      ? parseFloat(String(state.visado.monto.value).replace(/,/g, ".")) || 0
      : 0;
  }
  function totalHonorarios() {
    const base = parseFloat(String(state.monto.value).replace(/,/g, ".")) || 0;
    return base + visadoMonto();
  }

  function updatePagoUI() {
    // Suma de hitos
    const suma = sumHitos();
    state.pago.sumaHitos.textContent = `Suma de hitos: ${formatCurrency(suma, state.moneda.value)}`;

    // Cuotas
    const n = Math.max(2, parseInt(state.pago.cuotasCant.value || "0", 10));
    const total = totalHonorarios();
    const porCuota = total / n;
    state.pago.cuotasInfo.textContent = `${n} cuotas de ${formatCurrency(
      porCuota,
      state.moneda.value
    )} (total ${formatCurrency(total, state.moneda.value)})`;

    updatePreview();
  }

  // ========== Render ==========
  function updateAll() {
    const monto = parseFloat(String(state.monto.value).replace(/,/g, ".")) || 0;
    state.montoHint.textContent = `Se mostrará como ${formatCurrency(monto, state.moneda.value)}`;
    updatePagoUI();
    void updateDashboard();
  }

  function toggleCustomName() {
    const isCustom = state.modelo.value === "otro";
    state.wrapCustom.classList.toggle("hidden", !isCustom);
  }

  function currentTemplate() {
    const key = state.modelo.value;
    const base = TEMPLATES[key] || TEMPLATES.mensuraPosesion;
    if (key === "otro") {
      // Clonar y reemplazar el name por el que ponga el usuario
      const clone = JSON.parse(JSON.stringify(base));
      const customName = (state.modeloCustom.value || "Trabajo personalizado").trim();
      clone.name = customName;
      return clone;
    }
    return base;
  }

  function buildHeaderHTML() {
    const logoUrl = logoDataURL || normalizeLogoUrl(state.empresa.logo.value);
    const razon = state.empresa.razon.value || "";
    const profesional = state.empresa.profesional.value || "";
    const fechaStr = formatDateLong(state.fecha.value);

    return `
      <div class="flex items-start justify-between border-b pb-4">
        <div class="flex items-center gap-4">
          ${
            logoUrl
              ? `<img src="${logoUrl}" alt="Logo" crossorigin="anonymous"
                   class="h-16 w-16 object-cover rounded-full ring-2 ring-amber-300">`
              : `<div class="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold border border-amber-300">LOGO</div>`
          }
        </div>
        <div class="flex-1 text-center">
          <div class="text-3xl md:text-4xl font-extrabold tracking-wide" style="color:#F2C94C">${razon.toUpperCase()}</div>
        </div>
        <div class="text-right text-sm">
          ${profesional ? `<div class="italic text-gray-700">${profesional}</div>` : ""}
          <div class="text-gray-600">${fechaStr}</div>
        </div>
      </div>`;
  }

  function updatePreview() {
    try {
      const tpl = currentTemplate();
      const baseMonto = parseFloat(String(state.monto.value).replace(/,/g, ".")) || 0;
      const total = totalHonorarios();

      // View para Mustache
      const view = {
        nombre: state.comitente.value,
        lugar: state.ubicacion.value,
        fechaLarga: formatDateLong(state.fecha.value),
        montoFormateado: formatCurrency(baseMonto, state.moneda.value),
        validez: state.validez.value,
      };

      const descripcionBase = state.textoModelo.value.trim()
        ? state.textoModelo.value
        : tpl.description;
      const descripcion = Mustache.render(descripcionBase, view);
      const leyendaLegal = Mustache.render(state.empresa.leyenda.value || "", {
        validez: state.validez.value,
      });

      state.doc.classList.remove("flex", "items-center", "justify-center");

      state.doc.innerHTML = `
        <div class="avoid-break">${buildHeaderHTML()}</div>

        <!-- Datos del presupuesto -->
        <div class="grid grid-cols-2 gap-2 text-sm mb-4 mt-4 avoid-break">
          <div><span class="font-medium">Comitente:</span> ${state.comitente.value || "—"}</div>
          <div><span class="font-medium">Teléfono:</span> ${state.telefono.value || "—"}</div>
          <div><span class="font-medium">N° de Cuenta:</span> ${state.email.value || "—"}</div>
          <div><span class="font-medium">Ubicación:</span> ${state.ubicacion.value || "—"}</div>
        </div>

        <!-- Título -->
        <div class="my-4 py-2 border-y border-gray-200 text-center avoid-break">
          <span class="text-xl md:text-2xl font-bold">Presupuesto:</span>
          <span class="text-xl md:text-2xl text-blue-700 underline underline-offset-4">${tpl.name}</span>
        </div>

        <!-- Cuerpo -->
        <div class="leading-relaxed text-[15px] text-justify">
          <p class="whitespace-pre-wrap">${descripcion}</p>

          ${(tpl.alcance && tpl.alcance.length)
            ? `
              <div class="mt-3">
                <div class="font-semibold">Alcance</div>
                <ul class="list-disc ml-5 mt-1">
                  ${tpl.alcance.map(item => `<li>${item}</li>`).join("")}
                </ul>
              </div>
            ` : ""}

          ${(tpl.etapas && tpl.etapas.length)
            ? `
              <div class="mt-4">
                <div class="font-semibold">Etapas</div>
                ${tpl.etapas.map(et => `
                  <div class="mt-2">
                    <div class="font-medium">${et.titulo}</div>
                    ${(et.items && et.items.length)
                      ? `<ul class="list-disc ml-5 mt-1">${et.items.map(i => `<li>${i}</li>`).join("")}</ul>`
                      : ""
                    }
                  </div>
                `).join("")}
              </div>
            ` : ""}
        </div>

        <!-- Honorarios -->
        <div class="mt-6 avoid-break">
          <div class="rounded-xl border border-amber-200">
            <div class="px-4 py-2 bg-amber-50 border-b border-amber-200 font-semibold text-blue-900">
              Honorarios Profesionales
            </div>
            <div class="p-4 text-sm space-y-1">
              <div class="flex justify-between py-1">
                <span>Subtotal (honorarios)</span>
                <span>${formatCurrency(baseMonto, state.moneda.value)}</span>
              </div>
              ${visadoSeleccionado() ? `
                <div class="flex justify-between py-1">
                  <span>Visado colegio de ingenieros</span>
                  <span>${formatCurrency(visadoMonto(), state.moneda.value)}</span>
                </div>` : ""}
              <div class="flex justify-between border-t mt-2 pt-2 font-semibold">
                <span>TOTAL</span>
                <span>${formatCurrency(total, state.moneda.value)}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Forma de pago -->
        <div class="mt-4 avoid-break">
          <div class="rounded-xl border">
            <div class="px-4 py-2 bg-amber-50 border-b border-amber-200 font-semibold text-blue-900">Forma de pago</div>
            <div class="p-4 text-sm">
              ${
                state.pago.modoAvance.checked
                  ? `
                    <ul class="list-disc ml-5 space-y-1">
                      ${
                        getHitos().map(h => `<li>${h.d || "(sin descripción)"} – <b>${formatCurrency(h.m || 0, state.moneda.value)}</b></li>`).join("") || "<li>(Agregar hitos)</li>"
                      }
                    </ul>
                    <div class="text-right mt-2 text-xs text-gray-600">
                      Suma de hitos: ${formatCurrency(sumHitos(), state.moneda.value)}
                    </div>
                  `
                  : `
                    <div>
                      ${Math.max(2, parseInt(state.pago.cuotasCant.value || "0", 10))} cuotas de
                      <b>${formatCurrency(
                        total / Math.max(2, parseInt(state.pago.cuotasCant.value || "0", 10)),
                        state.moneda.value
                      )}</b>
                      (total ${formatCurrency(total, state.moneda.value)})
                    </div>
                  `
              }
            </div>
          </div>
        </div>

        ${
          state.observaciones.value.trim()
            ? `<div class="mt-4 text-sm"><span class="font-medium">Observaciones:</span> ${state.observaciones.value.trim()}</div>`
            : ""
        }

        <div class="mt-6 text-xs text-gray-600 border-t pt-3 avoid-break">${leyendaLegal}</div>
      `;
    } catch (e) {
      state.doc.innerHTML = `<div class="text-red-600 p-4">Error renderizando: ${e.message}</div>`;
      console.error(e);
    }
  }

  // ========== Eventos UI ==========
  const inputsToWatch = [
    state.fecha, state.modelo, state.modeloCustom, state.comitente, state.telefono, state.email,
    state.ubicacion, state.moneda, state.monto, state.plazo, state.validez,
    state.observaciones, state.empresa.razon, state.empresa.profesional,
    state.empresa.cuit, state.empresa.dom, state.empresa.email, state.empresa.tel,
    state.empresa.logo, state.empresa.leyenda, state.textoModelo
  ];

  // Escucha 'input' en la mayoría de campos
  inputsToWatch.forEach((el) => el && el.addEventListener("input", () => {
    if (el === state.modelo) toggleCustomName();
    updateAll();
  }));

  // Asegurar que los controles que suelen disparar 'change' también refresquen
  if (state.fecha) {
    state.fecha.addEventListener("change", () => {
      updateAll();
    });
  }

  if (state.modelo) {
    state.modelo.addEventListener("change", () => {
      toggleCustomName();
      updateAll();
    });
  }

  // Descargar PDF (multipágina)
  state.btnDescargar.addEventListener("click", async () => {
    const originalBtnText = state.btnDescargar.textContent;
    try {
      state.btnDescargar.disabled = true;
      state.btnDescargar.textContent = "Generando PDF...";

      await ensureLibsLoaded();
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      let usedTextFallback = false;

      try {
        const canvas = await html2canvas(state.doc, {
          scale: 1.4,
          useCORS: true,
          allowTaint: true,
          backgroundColor: "#ffffff",
          windowWidth: state.doc.scrollWidth || 794,
        });

        if (!canvas.width || !canvas.height || isCanvasMostlyBlank(canvas)) {
          throw new Error("Captura sin contenido");
        }

        const pageWidthMm = pdf.internal.pageSize.getWidth();
        const pageHeightMm = pdf.internal.pageSize.getHeight();
        const pageHeightPx = Math.floor((canvas.width * pageHeightMm) / pageWidthMm);
        const totalPages = Math.max(1, Math.ceil(canvas.height / pageHeightPx));

        for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
          const startY = pageIndex * pageHeightPx;
          const sliceHeight = Math.min(pageHeightPx, canvas.height - startY);

          const pageCanvas = document.createElement("canvas");
          pageCanvas.width = canvas.width;
          pageCanvas.height = sliceHeight;

          const pageCtx = pageCanvas.getContext("2d");
          if (!pageCtx) throw new Error("No se pudo obtener contexto de canvas");

          pageCtx.fillStyle = "#ffffff";
          pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
          pageCtx.drawImage(
            canvas,
            0,
            startY,
            canvas.width,
            sliceHeight,
            0,
            0,
            canvas.width,
            sliceHeight
          );

          const imgData = pageCanvas.toDataURL("image/jpeg", 0.95);
          const renderedHeightMm = (sliceHeight * pageWidthMm) / canvas.width;

          if (pageIndex > 0) pdf.addPage();
          pdf.addImage(imgData, "JPEG", 0, 0, pageWidthMm, renderedHeightMm, undefined, "FAST");
        }
      } catch (captureErr) {
        console.warn("Export visual falló, usando fallback en texto", captureErr);
        usedTextFallback = true;
        buildTextFallbackPdf(pdf);
      }

      // Nombre: Cliente + Tipo (sin ubicación)
      const tpl = currentTemplate();
      const nombre = safeFilenameStrict(state.comitente.value || "Cliente");
      const tipo = safeFilenameStrict(upperNoDiacritics(tpl.name));
      const filename = `${nombre}, ${tipo}.pdf`;

      downloadPdfBlob(pdf, filename);
      await registerCurrentQuote("pdf");
      if (usedTextFallback) {
        alert("El PDF visual falló en este navegador. Se descargó una versión de respaldo en texto.");
      }
    } catch (e) {
      alert(`No se pudo generar el PDF: ${e.message || "error desconocido"}`);
      console.error(e);
    } finally {
      state.btnDescargar.disabled = false;
      state.btnDescargar.textContent = originalBtnText;
    }
  });

  // Descargar .DOC (HTML básico)
  state.btnDoc.addEventListener("click", () => {
    try {
      const tpl = currentTemplate();
      const nombre = safeFilename(state.comitente.value || "Cliente");
      const tipo = upperNoDiacritics(tpl.name);
      const filename = `${nombre}, ${tipo}.doc`;

    // Envolvemos el HTML del documento en una estructura simple
      const html = `
        <!doctype html>
        <html><head><meta charset="utf-8"></head>
        <body>${state.doc.innerHTML}</body></html>
      `;
      const blob = new Blob([html], { type: "application/msword;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      void registerCurrentQuote("doc");
    } catch (e) {
      alert("No se pudo generar el DOC. Revisá la consola.");
      console.error(e);
    }
  });

  async function readRecords() {
    if (USE_REMOTE_BACKEND) {
      try {
        const response = await remoteApi.list();
        const records = Array.isArray(response && response.records) ? response.records : [];
        return records.map((record, index) => normalizeRecord(record, index));
      } catch (error) {
        console.warn(error);
        return readLocalRecords();
      }
    }

    return readLocalRecords();
  }

  async function saveRecords(records) {
    const normalized = Array.isArray(records)
      ? records.map((record, index) => normalizeRecord(record, index))
      : [];

    if (USE_REMOTE_BACKEND) {
      throw new Error("saveRecords solo se usa en modo local");
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function createCurrentRecord(source) {
    const tpl = currentTemplate();
    return {
      id: createRecordId(),
      source,
      createdAt: new Date().toISOString(),
      fechaPresupuesto: state.fecha.value || "",
      comitente: (state.comitente.value || "Sin nombre").trim(),
      trabajo: tpl.name,
      ubicacion: (state.ubicacion.value || "").trim(),
      moneda: state.moneda.value || "ARS",
      total: totalHonorarios(),
      approved: false,
    };
  }

  async function registerCurrentQuote(source) {
    const record = createCurrentRecord(source);

    if (USE_REMOTE_BACKEND) {
      const response = await remoteApi.create(record);
      if (response && response.duplicate) {
        await updateDashboard();
        return;
      }
      await updateDashboard();
      return;
    }

    const records = readLocalRecords();

    // Evita duplicados por doble clic del mismo archivo en pocos segundos.
    const last = records[0];
    if (last) {
      const seconds = (Date.now() - new Date(last.createdAt).getTime()) / 1000;
      const isSame =
        last.comitente === record.comitente &&
        last.trabajo === record.trabajo &&
        Number(last.total) === Number(record.total) &&
        last.moneda === record.moneda;
      if (isSame && seconds < 15) {
        return;
      }
    }

    records.unshift(record);
    saveLocalRecords(records.slice(0, 500));
    await updateDashboard();
  }

  async function updateDashboard() {
    if (!state.dashboard.totalARS || !state.dashboard.totalUSD || !state.dashboard.cantidad || !state.dashboard.mes || !state.dashboard.promedio) {
      return;
    }

    const records = await readRecords();
    const approvedRecords = records.filter((r) => r.approved);
    const totalARS = records
      .filter((r) => r.moneda === "ARS")
      .reduce((acc, r) => acc + (Number(r.total) || 0), 0);
    const totalUSD = records
      .filter((r) => r.moneda === "USD")
      .reduce((acc, r) => acc + (Number(r.total) || 0), 0);

    const now = new Date();
    const monthCount = records.filter((r) => {
      const d = new Date(r.createdAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;

    const currentCurrency = state.moneda.value || "ARS";
    const approvedSameCurrency = approvedRecords.filter((r) => r.moneda === currentCurrency);
    const approvedTotal = approvedSameCurrency.reduce((acc, r) => acc + (Number(r.total) || 0), 0);

    state.dashboard.totalARS.textContent = formatCurrency(totalARS, "ARS");
    state.dashboard.totalUSD.textContent = formatCurrency(totalUSD, "USD");
    state.dashboard.cantidad.textContent = String(approvedRecords.length);
    state.dashboard.mes.textContent = String(monthCount);
    state.dashboard.promedio.textContent = formatCurrency(approvedTotal, currentCurrency);

    renderDashboardRows(records);
  }

  function renderDashboardRows(records) {
    if (!state.dashboard.rows) return;

    if (!records.length) {
      state.dashboard.rows.innerHTML = `
        <tr>
          <td colspan="8" class="px-3 py-6 text-center text-gray-500">Todavía no hay presupuestos registrados.</td>
        </tr>
      `;
      return;
    }

    state.dashboard.rows.innerHTML = records
      .slice(0, 25)
      .map((r) => `
        <tr>
          <td class="px-3 py-2 whitespace-nowrap">${formatDateLong(r.fechaPresupuesto || r.createdAt)}</td>
          <td class="px-3 py-2">${r.comitente || "—"}</td>
          <td class="px-3 py-2">${r.trabajo || "—"}</td>
          <td class="px-3 py-2">${r.ubicacion || "—"}</td>
          <td class="px-3 py-2">${r.moneda || "ARS"}</td>
          <td class="px-3 py-2">
            <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${r.approved ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-600"}">
              ${r.approved ? "Aprobado" : "Pendiente"}
            </span>
          </td>
          <td class="px-3 py-2 text-right font-medium">${formatCurrency(r.total || 0, r.moneda || "ARS")}</td>
          <td class="px-3 py-2">
            <div class="flex items-center justify-center gap-2">
              <button type="button" data-action="toggle-approve" data-id="${r.id}" class="rounded-full px-3 py-1 text-xs font-medium ${r.approved ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}">
                ${r.approved ? "Aprobado" : "Marcar aprobado"}
              </button>
              <button type="button" data-action="delete" data-id="${r.id}" class="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-200" aria-label="Eliminar presupuesto">
                ✕
              </button>
            </div>
          </td>
        </tr>
      `)
      .join("");
  }

  async function toggleRecordApproved(id) {
    if (USE_REMOTE_BACKEND) {
      await remoteApi.toggle(id);
      await updateDashboard();
      return;
    }

    const records = readLocalRecords();
    const updated = records.map((record) =>
      record.id === id ? { ...record, approved: !record.approved } : record
    );
    saveLocalRecords(updated);
    await updateDashboard();
  }

  async function deleteRecord(id) {
    const ok = window.confirm("¿Eliminar este presupuesto del historial?");
    if (!ok) return;

    if (USE_REMOTE_BACKEND) {
      await remoteApi.remove(id);
      await updateDashboard();
      return;
    }

    const records = readLocalRecords();
    const updated = records.filter((record) => record.id !== id);
    saveLocalRecords(updated);
    await updateDashboard();
  }

  // ========== Helpers ==========
  function downloadPdfBlob(pdf, filename) {
    const blob = pdf.output("blob");

    // Edge legacy
    if (window.navigator && typeof window.navigator.msSaveOrOpenBlob === "function") {
      window.navigator.msSaveOrOpenBlob(blob, filename);
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function isCanvasMostlyBlank(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return true;

    const w = canvas.width;
    const h = canvas.height;
    const stepX = Math.max(1, Math.floor(w / 40));
    const stepY = Math.max(1, Math.floor(h / 60));
    let nonWhiteCount = 0;
    let total = 0;

    for (let y = 0; y < h; y += stepY) {
      for (let x = 0; x < w; x += stepX) {
        const p = ctx.getImageData(x, y, 1, 1).data;
        total += 1;
        const alpha = p[3];
        const isWhite = p[0] > 245 && p[1] > 245 && p[2] > 245;
        if (alpha > 0 && !isWhite) nonWhiteCount += 1;
      }
    }

    return total === 0 || nonWhiteCount / total < 0.01;
  }

  function buildTextFallbackPdf(pdf) {
    const tpl = currentTemplate();
    const baseMonto = parseFloat(String(state.monto.value).replace(/,/g, ".")) || 0;
    const total = totalHonorarios();

    const lines = [
      `${state.empresa.razon.value || "AGRIMENSOR YA"}`,
      `Fecha: ${formatDateLong(state.fecha.value)}`,
      "",
      `Comitente: ${state.comitente.value || "-"}`,
      `Telefono: ${state.telefono.value || "-"}`,
      `Nro de Cuenta: ${state.email.value || "-"}`,
      `Ubicacion: ${state.ubicacion.value || "-"}`,
      "",
      `Presupuesto: ${tpl.name}`,
      "",
      ...splitLongText((state.textoModelo.value || tpl.description || "").replace(/\s+/g, " "), 110),
      "",
      `Subtotal: ${formatCurrency(baseMonto, state.moneda.value)}`,
      visadoSeleccionado() ? `Visado: ${formatCurrency(visadoMonto(), state.moneda.value)}` : null,
      `TOTAL: ${formatCurrency(total, state.moneda.value)}`,
      "",
      `Plazo estimado: ${state.plazo.value || "-"}`,
      `Validez: ${state.validez.value || "-"}`,
      state.observaciones.value ? `Observaciones: ${state.observaciones.value}` : null,
    ].filter(Boolean);

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const maxY = pageH - margin;
    let y = margin;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(11);

    lines.forEach((line) => {
      const wrapped = pdf.splitTextToSize(String(line), pageW - margin * 2);
      wrapped.forEach((wline) => {
        if (y > maxY) {
          pdf.addPage();
          y = margin;
        }
        pdf.text(String(wline), margin, y);
        y += 6;
      });
      y += 1;
    });
  }

  function splitLongText(text, maxLen) {
    if (!text) return [];
    const words = text.split(" ");
    const result = [];
    let line = "";

    words.forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxLen) {
        if (line) result.push(line);
        line = word;
      } else {
        line = next;
      }
    });

    if (line) result.push(line);
    return result;
  }

  function ensureLibsLoaded() {
    // Garantiza que html2canvas / jsPDF / Mustache estén disponibles antes de exportar
    return new Promise((resolve, reject) => {
      let tries = 0;
      (function check() {
        if (window.html2canvas && window.jspdf && window.Mustache) return resolve();
        if (tries++ > 50) return reject(new Error("Librerías no disponibles"));
        setTimeout(check, 100);
      })();
    });
  }

  // Primer render (por si el defer de libs demora)
  updatePreview();
}
