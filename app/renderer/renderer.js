// Selekt DJ Downloader — UI logic (renderer)
const $ = (id) => document.getElementById(id);

// ===========================================================================
// i18n — one app, two languages.
// ===========================================================================
const I18N = {
  es: {
    tagline: "Tracks, sets & videos directo a tus carpetas.",
    savingIn: "Guardando en", change: "Cambiar",
    starting: "Iniciando…", ready: "Listo",
    tab_dl: "Descargar", tab_hist: "Historial", tab_queue: "Cola",
    dl_heading: "Descargar",
    url_label: "Pega un enlace (o una lista de reproducción)", paste: "Pegar",
    folder_label: "Carpeta destino · un clic",
    main_folder: "Principal", main_folder_lc: "carpeta principal",
    new_folder: "＋ Nueva carpeta", name_ph: "Nombre…",
    format_label: "Formato", audio_quality_label: "Calidad de audio",
    fmt_orig: "Video · Original (rápido)", fmt_best: "Video · Mejor calidad",
    bq_320: "320 kbps (mejor)", bq_192: "192 kbps", bq_128: "128 kbps (liviano)",
    playlist_label: "Lista completa", playlist_btn: "Descargar lista",
    playlist_title: "Activado = descarga toda la lista a la carpeta elegida",
    go: "Descargar", go_downloading: "Descargando…",
    save_hint_pre: "Se guardará en",
    how_title: "Cómo funciona", how_1: "Copia el enlace del video o audio.", how_2: "Pégalo y pulsa Descargar.",
    dup_label: "No duplicados", dup_btn: "Evitar duplicados",
    dup_toggle_title: "Avisa antes de volver a descargar el mismo archivo en la misma carpeta",
    dup_already: "Ya está en esta carpeta", dup_cancel: "Cancelar", dup_anyway: "Descargar igual",
    foot_strong: "Descarga con responsabilidad", foot_rest: "— solo contenido que poseas o tengas permiso de usar.",
    hist_heading: "Historial de descargas", hist_empty: "Aún no has descargado nada.",
    show: "Mostrar", play: "Reproducir", copy_link: "Copiar enlace", copied: "¡Copiado!",
    clear_hist: "Borrar historial",
    clear_hist_confirm: "¿Borrar todo el historial? No se borran los archivos descargados.",
    settings_title: "Carpeta principal", settings_sub: "Donde se guarda todo. Se configura una sola vez.",
    pick_main: "Elegir carpeta…", open: "Abrir",
    folders_label: "Carpetas · una por género, gig o proyecto", create: "Crear", no_folders: "Aún no hay carpetas.",
    done: "Listo", close: "Cerrar", rename: "Renombrar", remove: "Quitar", open_folder: "Abrir carpeta",
    remove_confirm: 'Quitar "{name}" de la lista. La carpeta y los archivos NO se borran. ¿Continuar?',
    paste_empty: "No hay nada para pegar.", no_link: "Pega un enlace primero.",
    done_msg: "✓ Listo — {n} archivo(s) en {folder}",
    err_pre: "Error:", dl_failed: "falló la descarga",
    badge_orig: "Original", badge_best: "Mejor",
    prev_loading: "Buscando info del enlace…",
    dest_label: "Carpetas · un clic para elegir destino",
    filter_ph: "Filtrar carpetas…", filter_clear: "Limpiar", filter_none: "Sin coincidencias",
    pin_title: "Fijar arriba", unpin_title: "Quitar de fijadas",
    created_label: "Carpetas creadas", fav_label: "Carpetas favoritas",
    add_fav: "＋ Añadir carpeta", fav_remove: "Quitar de favoritas",
    fav_missing: "Carpeta no disponible",
    fav_remove_confirm: 'Quitar "{name}" de favoritas. La carpeta NO se borra del disco. ¿Continuar?',
    fav_duplicate: 'La carpeta "{name}" ya está en favoritas.',
    folder_name_bad: "Nombre de carpeta no válido. Usa un solo nombre, sin / ni \\, y sin punto o espacio al final.",
    folder_create_failed: "No se pudo crear la carpeta. Revisa el nombre y los permisos.",
    dest_bad: "Destino no válido en esta descarga. Elige la carpeta de nuevo.",
    h1_not_allowed: "Esa acción no está permitida para ese archivo o carpeta.",
    h1_outside: "Ese archivo está fuera de la carpeta principal y de tus carpetas favoritas, así que no se puede abrir desde aquí. Si quitaste su carpeta favorita, vuelve a añadirla.",
    h1_missing: "No se encontró el archivo. Puede que lo hayas movido o borrado.",
    h1_folder_missing: "No se encontró la carpeta. Puede que la hayas movido o borrado.",
    h1_failed: "No se pudo abrir. Inténtalo de nuevo o ábrelo desde el explorador de archivos.",
    h1_trash_failed: "No se pudo mover el archivo a la papelera. No se borró.",
    h1_trash_busy: "Ese archivo ya se está moviendo a la papelera.",
    h1_trash_after_dismiss: "El aviso se cerró cuando ya había empezado a mover el archivo a la papelera, así que se movió. Puedes restaurarlo desde la papelera.",
    src_quality: "Fuente",
    lossless_warn: "Esta fuente es solo ~{abr} kbps.\nExportar a {fmt} no añade calidad, solo más peso.\n\n¿Descargar como {fmt} de todas formas?",
    suggest_prefix: "Sugerencia: carpeta",
    autotag_label: "Tag para DJ software", autotag_btn: "Auto-tag",
    autotag_title: "Añade título, artista, género y origen al archivo descargado",
    wav_no_tags: "WAV no guarda tags DJ — usa M4A o FLAC para tener metadatos.",
    loudnorm_label: "Normalizar volumen", loudnorm_btn: "Normalizar",
    loudnorm_title: "Iguala el volumen con estándar LUFS. Re-encoda el audio.",
    lufs_label: "Target", lufs_streaming: "-14 LUFS (streaming)", lufs_club: "-9 LUFS (club / fuerte)",
    normalizing_phase: "Normalizando…",
    norm_warn: "⚠ Descargado, pero SIN normalizar: {n} de {total} archivo(s) con su volumen original ({reason}).",
    norm_warn_in: "Guardado en {folder}.",
    norm_reason_measure: "no se pudo medir el volumen", norm_reason_apply: "ffmpeg no pudo aplicar la corrección",
    norm_reason_replace: "no se pudo reemplazar el archivo", norm_reason_error: "error inesperado",
    q_canceled_kept: "Cancelada al normalizar — lo descargado se conservó, sin normalizar. ↻ para reintentar",
    q_canceled_partial: "Cancelada al normalizar — {done} de {total} archivo(s) ya estaban normalizados y se conservaron; los demás se conservaron sin normalizar. ↻ para reintentar",
    q_canceled_all: "Cancelada — los {total} archivo(s) ya estaban normalizados y se conservaron. ↻ para reintentar",
    // Queue
    queue_heading: "Cola de descargas",
    queue_paste_label: "Pega uno o varios enlaces (uno por línea)",
    queue_input_ph: "https://…",
    queue_add: "Añadir a la cola",
    queue_run: "▶ Ejecutar cola",
    queue_pause: "⏸ Pausar",
    queue_resume: "▶ Reanudar",
    queue_clear: "Limpiar",
    queue_all_to: "Carpeta →",
    queue_apply_all: "Aplicar a todas",
    queue_empty: "La cola está vacía.",
    queue_summary: "{done} listas · {skip} omitidas · {err} errores",
    queue_resume_msg: "Hay elementos pendientes en la cola. ¿Continuar?",
    queue_resume_yes: "Reanudar",
    queue_resume_dismiss: "Luego",
    queue_th_status: "Estado",
    queue_th_url: "Enlace / Título",
    queue_th_folder: "Carpeta",
    queue_th_format: "Formato",
    queue_retry_failed: "↻ Reintentar fallidos",
    // Playlist track picker
    pl_pick_title: "Seleccionar pistas",
    pl_pick_sub: "{n} pistas · todas seleccionadas por defecto",
    pl_select_all: "Todas",
    pl_select_none: "Ninguna",
    pl_selected: "{n} seleccionadas",
    pl_download_sel: "Descargar {n}",
    pl_cancel: "Cancelar",
    pl_unavailable: "no disponible",
    pl_loading: "Cargando lista…",
    pl_empty: "No se encontraron pistas en esta lista.",
    pl_track: "Pista {n}/{m}",
    pl_close: "Cerrar",
    pl_st_pending: "en espera",
    pl_status_downloading: "Descargando… puedes cerrar esta ventana; la descarga continúa.",
    pl_status_done: "✓ Lista completada",
    pl_status_ended: "Descarga finalizada",
    q_retry: "Reintentar",
    q_skipped_dup: "Ya está en la carpeta (duplicado) — ↻ para descargar igual",
    // Watch
    watch_sect_label: "Watch folder · desde el teléfono",
    watch_btn: "Activar",
    watch_inbox_label: "Archivo inbox (iCloud / Dropbox)",
    watch_folder_label: "Carpeta destino por defecto",
    watch_autorun_btn: "Auto-ejecutar",
    watch_help: "iOS Shortcut: Share Sheet → \"Append to File\" → inbox.txt en iCloud",
    watch_pick: "Elegir…",
    watch_watching: "Vigilando cambios…",
    watch_stopped: "Detenido",
    watch_dest_missing: "⚠ Carpeta no disponible: {name} — elige otra",
    // Fingerprint
    fp_sect_label: "Detección de canciones duplicadas (audio)",
    fp_btn: "Detectar duplicados por audio",
    fp_threshold_label: "Sensibilidad",
    fp_th_strict: "Estricta (95%)",
    fp_th_normal: "Normal (90%)",
    fp_th_loose: "Relajada (80%)",
    fp_rebuild: "Reconstruir librería",
    fp_rebuilding: "Reconstruyendo…",
    fp_status_ok: "fpcalc disponible · {n} huellas en la librería",
    fp_status_missing: "fpcalc no encontrado — coloca el binario en bin/fpcalc",
    fp_dup_head: "Posible canción duplicada",
    fp_dup_keep: "Conservar ambos",
    fp_dup_open: "Abrir original",
    fp_dup_delete: "Eliminar nuevo",
    // Cookies
    cookies_label: "Cookies del navegador · videos con restricción de edad",
    cookies_none: "Ninguno (por defecto)",
    cookies_help: "Elige el navegador donde tienes sesión iniciada en YouTube. En Mac: Safari requiere Acceso total al disco; Chrome puede pedir permiso del Llavero.",
    cookies_hint: "Este video necesita iniciar sesión (restricción de edad o verificación). Abre Cambiar → Cookies del navegador, elige tu navegador con sesión en YouTube y vuelve a intentar.",
    // Folder view
    view_chips: "Vista de chips", view_list: "Vista de lista", files_label: "archivos",
    density_comfortable: "Cómodo", density_compact: "Compacto",
    density_comfortable_t: "Carpetas grandes", density_compact_t: "Carpetas pequeñas (más compactas)",
    dup_preq: "Esta versión ya está descargada en:\n\nCarpeta:  {folder}\nFormato:  {format}\n\n¿Descargar de todas formas?",
    queued_msg: "✓ Añadido a la cola — {folder}",
    dl_now: "↓ {title} · {n} en cola",
    queue_done: "✓ Cola completada",
    downloading_label: "Descargando", queue_waiting: "{n} en espera",
    cancel_dl: "Cancelar", cancel_dl_title: "Detener esta descarga y pasar a la siguiente de la cola",
    stop_all: "Detener todo", stop_all_title: "Detener esta descarga y cancelar todo lo que está en espera",
    retry_no_cookies: "Reintentando sin cookies del navegador…",
    retry_engine_update: "Actualizando el motor de descarga…",
    canceling: "Cancelando…",
    canceled_msg: "Descarga cancelada",
    canceled_all_msg: "Detenido — {n} en espera cancelada(s)",
    q_canceled: "Cancelada — ↻ para reintentar",
  },
  en: {
    tagline: "Tracks, sets & videos straight to your folders.",
    savingIn: "Saving to", change: "Change",
    starting: "Starting…", ready: "Ready",
    tab_dl: "Download", tab_hist: "History", tab_queue: "Queue",
    dl_heading: "Download",
    url_label: "Paste a link (or a playlist)", paste: "Paste",
    folder_label: "Target folder · one click",
    main_folder: "Main", main_folder_lc: "main folder",
    new_folder: "＋ New folder", name_ph: "Name…",
    format_label: "Format", audio_quality_label: "Audio quality",
    fmt_orig: "Video · Original (fast)", fmt_best: "Video · Best quality",
    bq_320: "320 kbps (best)", bq_192: "192 kbps", bq_128: "128 kbps (light)",
    playlist_label: "Whole list", playlist_btn: "Download list",
    playlist_title: "On = download the whole list into the chosen folder",
    go: "Download", go_downloading: "Downloading…",
    save_hint_pre: "Will save to",
    how_title: "How it works", how_1: "Copy the link of the video or audio.", how_2: "Paste it and press Download.",
    dup_label: "No duplicates", dup_btn: "Avoid duplicates",
    dup_toggle_title: "Warns before re-downloading the same file to the same folder",
    dup_already: "Already in this folder", dup_cancel: "Cancel", dup_anyway: "Download anyway",
    foot_strong: "Download responsibly", foot_rest: "— only content you own or have permission to use.",
    hist_heading: "Download history", hist_empty: "You haven't downloaded anything yet.",
    show: "Show", play: "Play", copy_link: "Copy link", copied: "Copied!",
    clear_hist: "Clear history",
    clear_hist_confirm: "Clear all history? Your downloaded files are not deleted.",
    settings_title: "Main folder", settings_sub: "Where everything is saved. Set it once.",
    pick_main: "Choose folder…", open: "Open",
    folders_label: "Folders · one per genre, gig or project", create: "Create", no_folders: "No folders yet.",
    done: "Done", close: "Close", rename: "Rename", remove: "Remove", open_folder: "Open folder",
    remove_confirm: 'Remove "{name}" from the list. The folder and files are NOT deleted. Continue?',
    paste_empty: "Nothing to paste.", no_link: "Paste a link first.",
    done_msg: "✓ Done — {n} file(s) in {folder}",
    err_pre: "Error:", dl_failed: "download failed",
    badge_orig: "Original", badge_best: "Best",
    prev_loading: "Fetching link info…",
    dest_label: "Folders · one click to set destination",
    filter_ph: "Filter folders…", filter_clear: "Clear", filter_none: "No matches",
    pin_title: "Pin to top", unpin_title: "Unpin",
    created_label: "Created folders", fav_label: "Favorite folders",
    add_fav: "＋ Add folder", fav_remove: "Remove from favorites",
    fav_missing: "Folder unavailable",
    fav_remove_confirm: 'Remove "{name}" from favorites. The folder is NOT deleted from disk. Continue?',
    fav_duplicate: '"{name}" is already in favorites.',
    folder_name_bad: "Invalid folder name. Use a single name, without / or \\, and no trailing dot or space.",
    folder_create_failed: "Couldn't create the folder. Check the name and permissions.",
    dest_bad: "Invalid destination for this download. Choose the folder again.",
    h1_not_allowed: "That action isn't allowed for that file or folder.",
    h1_outside: "That file is outside the main folder and your favorite folders, so it can't be opened from here. If you removed its favorite folder, add it again.",
    h1_missing: "File not found. It may have been moved or deleted.",
    h1_folder_missing: "Folder not found. It may have been moved or deleted.",
    h1_failed: "Couldn't open that. Try again, or open it from your file manager.",
    h1_trash_failed: "Couldn't move the file to the trash. It was not deleted.",
    h1_trash_busy: "That file is already being moved to the trash.",
    h1_trash_after_dismiss: "The warning was closed after the move to the trash had already started, so the file was moved. You can restore it from the trash.",
    src_quality: "Source",
    lossless_warn: "This source is only ~{abr} kbps.\nExporting to {fmt} won't add quality — just a bigger file.\n\nDownload as {fmt} anyway?",
    suggest_prefix: "Suggested folder:",
    autotag_label: "Tag for DJ software", autotag_btn: "Auto-tag",
    autotag_title: "Embeds title, artist, genre and source URL into downloaded files",
    wav_no_tags: "WAV can't hold DJ tags — use M4A or FLAC for tagged files.",
    loudnorm_label: "Normalize loudness", loudnorm_btn: "Normalize",
    loudnorm_title: "Levels audio to a LUFS target. Re-encodes the audio.",
    lufs_label: "Target", lufs_streaming: "-14 LUFS (streaming)", lufs_club: "-9 LUFS (club / loud)",
    normalizing_phase: "Normalizing…",
    norm_warn: "⚠ Downloaded, but NOT normalized: {n} of {total} file(s) kept at their original loudness ({reason}).",
    norm_warn_in: "Saved in {folder}.",
    norm_reason_measure: "couldn't measure the loudness", norm_reason_apply: "ffmpeg couldn't apply the correction",
    norm_reason_replace: "couldn't replace the file", norm_reason_error: "unexpected error",
    q_canceled_kept: "Cancelled while normalizing — what was downloaded was kept, not normalized. ↻ to retry",
    q_canceled_partial: "Cancelled while normalizing — {done} of {total} file(s) were already normalized and kept; the rest were kept, not normalized. ↻ to retry",
    q_canceled_all: "Cancelled — all {total} file(s) were already normalized and kept. ↻ to retry",
    // Queue
    queue_heading: "Download queue",
    queue_paste_label: "Paste one or more links (one per line)",
    queue_input_ph: "https://…",
    queue_add: "Add to queue",
    queue_run: "▶ Run queue",
    queue_pause: "⏸ Pause",
    queue_resume: "▶ Resume",
    queue_clear: "Clear",
    queue_all_to: "Folder →",
    queue_apply_all: "Apply to all",
    queue_empty: "Queue is empty.",
    queue_summary: "{done} done · {skip} skipped · {err} errors",
    queue_resume_msg: "There are pending items in the queue. Continue?",
    queue_resume_yes: "Resume",
    queue_resume_dismiss: "Later",
    queue_th_status: "Status",
    queue_th_url: "Link / Title",
    queue_th_folder: "Folder",
    queue_th_format: "Format",
    queue_retry_failed: "↻ Retry failed",
    // Playlist track picker
    pl_pick_title: "Select tracks",
    pl_pick_sub: "{n} tracks · all selected by default",
    pl_select_all: "All",
    pl_select_none: "None",
    pl_selected: "{n} selected",
    pl_download_sel: "Download {n}",
    pl_cancel: "Cancel",
    pl_unavailable: "unavailable",
    pl_loading: "Loading playlist…",
    pl_empty: "No tracks found in this playlist.",
    pl_track: "Track {n}/{m}",
    pl_close: "Close",
    pl_st_pending: "waiting",
    pl_status_downloading: "Downloading… you can close this window; it keeps going.",
    pl_status_done: "✓ Playlist complete",
    pl_status_ended: "Download finished",
    q_retry: "Retry",
    q_skipped_dup: "Already in folder (duplicate) — ↻ to download anyway",
    // Watch
    watch_sect_label: "Watch folder · from your phone",
    watch_btn: "Enable",
    watch_inbox_label: "Inbox file (iCloud / Dropbox)",
    watch_folder_label: "Default destination folder",
    watch_autorun_btn: "Auto-run",
    watch_help: 'iOS Shortcut: Share Sheet → "Append to File" → inbox.txt in iCloud',
    watch_pick: "Choose…",
    watch_watching: "Watching for changes…",
    watch_stopped: "Stopped",
    watch_dest_missing: "⚠ Folder unavailable: {name} — choose another",
    // Fingerprint
    fp_sect_label: "Audio duplicate detection",
    fp_btn: "Detect audio duplicates",
    fp_threshold_label: "Sensitivity",
    fp_th_strict: "Strict (95%)",
    fp_th_normal: "Normal (90%)",
    fp_th_loose: "Relaxed (80%)",
    fp_rebuild: "Rebuild library",
    fp_rebuilding: "Rebuilding…",
    fp_status_ok: "fpcalc available · {n} fingerprints in library",
    fp_status_missing: "fpcalc not found — place the binary in bin/fpcalc",
    fp_dup_head: "Possible audio duplicate",
    fp_dup_keep: "Keep both",
    fp_dup_open: "Open original",
    fp_dup_delete: "Delete new",
    // Cookies
    cookies_label: "Browser cookies · age-restricted videos",
    cookies_none: "None (default)",
    cookies_help: "Pick the browser where you're signed into YouTube. On Mac: Safari needs Full Disk Access; Chrome may prompt for Keychain access.",
    cookies_hint: "This video requires sign-in (age-restricted or bot check). Open Change → Browser cookies, pick the browser you're signed into YouTube with, then try again.",
    // Folder view
    view_chips: "Chip view", view_list: "List view", files_label: "files",
    density_comfortable: "Comfortable", density_compact: "Compact",
    density_comfortable_t: "Larger folders", density_compact_t: "Smaller folders (more compact)",
    dup_preq: "This version is already downloaded in:\n\nFolder:  {folder}\nFormat:  {format}\n\nDownload anyway?",
    queued_msg: "✓ Added to queue — {folder}",
    dl_now: "↓ {title} · {n} in queue",
    queue_done: "✓ Queue done",
    downloading_label: "Downloading", queue_waiting: "{n} waiting",
    cancel_dl: "Cancel", cancel_dl_title: "Stop this download and move on to the next queued link",
    stop_all: "Stop all", stop_all_title: "Stop this download and cancel everything still waiting",
    retry_no_cookies: "Retrying without browser cookies…",
    retry_engine_update: "Updating the download engine…",
    canceling: "Cancelling…",
    canceled_msg: "Download cancelled",
    canceled_all_msg: "Stopped — {n} waiting item(s) cancelled",
    q_canceled: "Cancelled — ↻ to retry",
  },
};

let LANG = "es";
function t(k) { return (I18N[LANG] && I18N[LANG][k]) || I18N.es[k] || k; }

function applyI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll("[data-i18n-aria]").forEach(el => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  $("langBtn").innerHTML =
    `<span style="color:${LANG==="es"?"var(--text)":"var(--faint)"};font-weight:${LANG==="es"?"800":"600"}">ES</span>` +
    `<span style="color:var(--line);margin:0 4px">/</span>` +
    `<span style="color:${LANG==="en"?"var(--text)":"var(--faint)"};font-weight:${LANG==="en"?"800":"600"}">EN</span>`;
  $("statusText").textContent = setupReady ? t("ready") : (setupMsg || t("starting"));
  renderDestinations(); renderManage(); syncHint();
  if ($("tab-hist").style.display !== "none") refreshHistory();
  if ($("tab-queue").style.display !== "none") renderQueue();
}

// ===========================================================================
// colour-coded folders
// ===========================================================================
const PALETTE = ["#e50914", "#2f9bff", "#9b6bff", "#ff9e2c", "#19c7a0", "#ff5fa2", "#f5d020", "#7c8cff"];
function colorFor(name) {
  if (!name) return "#8a8a96";
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

let currentTarget = "";
let currentFav = null;
let mainFolderName = "";
let knownFolders = [];
let knownFavs = [];
let pinnedSet = new Set();
let folderFilter = "";
let setupReady = false;
let setupMsg = "";   // latest non-ready setup message (progress or error), kept so the ES/EN switch doesn't reset it

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
function normalize(s) {
  return String(s || "").normalize("NFD").replace(DIACRITICS, "").toLowerCase();
}
// Initial values = the app defaults (main.js DEFAULTS); refreshSettings() replaces them with saved choices.
const DEFAULT_AUDIO_BITRATE = "320";   // kbps; keep equal to main.js DEFAULTS.audioBitrate and the selected #bitrate option
let preventDuplicates = true;
let pendingDupOpts = null;
let lastProbe = null;
let autoTagEnabled = true;
let loudnormEnabled = true;
let lufsValue = -14;
let folderView = "chips";       // "chips" | "list"
let folderDensity = "compact";  // "compact" | "comfortable"
let folderCounts = {};          // destId-keyed file counts: "main" | "f:<name>" | "p:<path>"

const GENRE_HINTS = {
  "afrobeat": "Afro", "afro house": "Afro House", "amapiano": "Amapiano",
  "dancehall": "Dancehall", "reggaeton": "Reggaeton", "reggae": "Reggae",
  "dembow": "DemBow", "salsa": "Exotico-Salsa", "bachata": "Latin",
  "hip hop": "Hip Hop", "hiphop": "Hip Hop", "rap": "Hip Hop",
  "soca": "Soca", "shatta": "Shatta", "zouk": "Zouk-Kizomba",
  "kizomba": "Zouk-Kizomba", "arabic": "Arabic", "ragga": "Ragga",
};

function suggestFolder(probe) {
  if (!probe) return null;
  const hay = normalize(`${probe.title || ""} ${probe.uploader || ""}`);
  for (const name of knownFolders) {
    if (hay.includes(normalize(name))) return name;
  }
  for (const [frag, folder] of Object.entries(GENRE_HINTS)) {
    if (hay.includes(normalize(frag)) && knownFolders.includes(folder)) return folder;
  }
  return null;
}

// ---- status / progress ----
const statusEl = $("status"), statusText = $("statusText");
api.onSetupStatus((m) => {
  setupReady = (m === "Ready.");
  setupMsg = setupReady ? "" : String(m || "");
  statusText.textContent = setupReady ? t("ready") : (setupMsg || t("starting"));
  statusText.title = setupReady ? "" : setupMsg;   // full text on hover if a long error is shortened
  statusEl.classList.toggle("ready", setupReady);
});
api.onProgress((p) => {
  const phase = (p && p.phase) || "";
  const pct   = typeof p === "object" ? p.percent : p;
  const speed = typeof p === "object" ? p.speed   : "";
  const eta   = typeof p === "object" ? p.eta     : "";
  const itemPos   = (typeof p === "object" && p.itemPos)   || 0;
  const itemTotal = (typeof p === "object" && p.itemTotal) || 0;
  const itemTitle = (typeof p === "object" && p.itemTitle) || "";

  // Update the active queue row (if a queue item is downloading)
  if (queueRunning && queueActiveId) {
    updateQueueRowProgress(queueActiveId, phase === "normalizing"
      ? { phase: "normalizing" }
      : { pct, itemPos, itemTotal, itemTitle });
  }

  // Playlist: show the current song title and a "Track N/M" counter on the card
  // (decoupled — the title still updates even if the counter line was missed).
  if (itemTitle) $("dlActiveTitle").textContent = itemTitle;
  if (itemTotal > 0) {
    $("dlActiveTrack").textContent = t("pl_track").replace("{n}", itemPos || 1).replace("{m}", itemTotal);
  }

  // Live per-track view inside the picker dialog (if still open / tracking).
  if (plProgress && itemTotal > 0 && phase !== "normalizing") updatePlaylistProgress(itemPos, Number(pct));

  // Drive the prominent "Downloading" card on the Download tab.
  $("dlActive").style.display = "block";
  const bar = $("dlActiveBar");
  if (phase === "normalizing" || phase === "retry" || phase === "engine-update") {
    bar.classList.add("indet");
    $("dlActiveFill").style.width = ""; $("dlActiveFill").style.marginLeft = "";
    $("dlActivePct").textContent = "";
    $("dlActivePhase").textContent = phase === "retry" ? t("retry_no_cookies")
      : phase === "engine-update" ? t("retry_engine_update")
      : t("normalizing_phase");
    $("dlActiveSpeed").textContent = ""; $("dlActiveEta").textContent = "";
    if (phase === "retry" || phase === "engine-update") {
      const msg = $("msg");
      if (msg) { msg.className = ""; msg.textContent = $("dlActivePhase").textContent; }
    }
    return;
  }
  const n = Number(pct);
  if (n > 0) {
    bar.classList.remove("indet");
    $("dlActiveFill").style.marginLeft = "0";
    $("dlActiveFill").style.width = Math.min(100, n) + "%";
    $("dlActivePct").textContent = Math.round(n) + "%";
  } else {
    // no real % yet — show the sliding stripe so it's clearly working
    bar.classList.add("indet");
    $("dlActiveFill").style.width = ""; $("dlActiveFill").style.marginLeft = "";
    $("dlActivePct").textContent = "";
  }
  $("dlActiveSpeed").textContent = speed || "";
  $("dlActiveEta").textContent   = eta ? "ETA " + eta : "";
  $("dlActivePhase").textContent = "";
});

// ---- settings ----
async function refreshSettings() {
  const s = await api.getSettings();
  if (s.lang) LANG = s.lang;
  pinnedSet = new Set(s.pinned || []);
  const full = s.main_folder || "";
  $("mainPath").textContent = full; $("mainPath").title = full;
  mainFolderName = full ? full.split("/").filter(Boolean).pop() : "";
  const short = mainFolderName ? "…/" + mainFolderName : "—";
  $("destPath").textContent = short; $("destPath").title = full;
  preventDuplicates = s.prevent_duplicates !== false;   // default on; an explicit false is kept
  $("dupToggle").classList.toggle("active", preventDuplicates);
  $("dupToggle").setAttribute("aria-pressed", String(preventDuplicates));
  autoTagEnabled = s.auto_tag !== false;
  loudnormEnabled = s.loudnorm !== false;                // default on; an explicit false is kept
  lufsValue = s.lufs || -14;
  $("autoTagToggle").classList.toggle("active", autoTagEnabled);
  $("autoTagToggle").setAttribute("aria-pressed", String(autoTagEnabled));
  $("loudnormToggle").classList.toggle("active", loudnormEnabled);
  $("loudnormToggle").setAttribute("aria-pressed", String(loudnormEnabled));
  $("lufsWrap").style.display = loudnormEnabled ? "" : "none";
  if ($("lufsSelect")) $("lufsSelect").value = String(lufsValue);
  if ($("cookiesBrowser")) $("cookiesBrowser").value = s.cookies_browser || "";
  folderView = s.folder_view === "list" ? "list" : "chips";
  if ($("viewChips")) $("viewChips").classList.toggle("active", folderView === "chips");
  if ($("viewList")) $("viewList").classList.toggle("active", folderView === "list");
  folderDensity = s.folder_density === "comfortable" ? "comfortable" : "compact";
  if ($("densCompact")) $("densCompact").classList.toggle("active", folderDensity === "compact");
  if ($("densComfort")) $("densComfort").classList.toggle("active", folderDensity === "comfortable");
  const savedFmt = s.ui_format || s.audio_format;
  if (savedFmt && $("format")) $("format").value = savedFmt;
  if (s.audio_bitrate && $("bitrate")) $("bitrate").value = String(s.audio_bitrate);
  updateBitrateVis();
  updateDockSummary();
}

// File counts for the list view — fetched on folder refresh, cached for renders.
async function refreshFolderCounts() {
  try { folderCounts = (await api.getFolderCounts()) || {}; }
  catch { folderCounts = {}; }
}

// ---- folders ----
async function refreshFolders() {
  const r = await api.listFolders();
  knownFolders = r.folders || [];
  if (currentTarget && !knownFolders.includes(currentTarget)) currentTarget = "";
  await syncPins();
  await refreshFolderCounts();
  renderDestinations();
  syncHidden();
  renderManage();
  syncHint();
  populateQueueFolderSelects();
}

async function refreshFavorites() {
  knownFavs = (await api.getFavorites()) || [];
  if (currentFav) {
    const still = knownFavs.find(f => f.path === currentFav.path);
    if (!still) { currentFav = null; syncHint(); }
  }
  await syncPins();
  await refreshFolderCounts();
  renderDestinations();
  populateQueueFolderSelects();
}

async function syncPins() {
  const s = await api.getSettings();
  pinnedSet = new Set(s.pinned || []);
}

function destId(d) { return d.kind === "fav" ? "p:" + d.path : "f:" + d.value; }

function buildDestinations() {
  const list = [];
  knownFolders.forEach(name =>
    list.push({ kind: "folder", value: name, name, path: null, available: true }));
  knownFavs.forEach(f =>
    list.push({ kind: "fav", value: "", name: f.name, path: f.path, available: f.available !== false }));
  list.forEach(d => { d.pinned = pinnedSet.has(destId(d)); });
  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return list;
}

function visibleDestinations() {
  const f = normalize(folderFilter);
  return buildDestinations().filter(d => !f || normalize(d.name).includes(f));
}

function renderDestinations() {
  const c = $("folderChips"); if (!c) return;
  // Re-rendering replaces every chip: remember which control had keyboard focus and give it back afterwards.
  let keep = null;
  const act = document.activeElement;
  if (act && c.contains(act)) {
    const host = act.closest(".chip,.frow");
    if (host) keep = { folder: host.dataset.folder, fav: host.dataset.favPath, pin: act.classList.contains("pin") };
  }
  [["viewChips", folderView === "chips"], ["viewList", folderView === "list"],
   ["densCompact", folderDensity === "compact"], ["densComfort", folderDensity === "comfortable"]]
    .forEach(([id, on]) => { const b = $(id); if (b) b.setAttribute("aria-pressed", String(on)); });
  c.className = "chips" +
    (folderView === "list" ? " list-view" : "") +
    (folderDensity === "compact" ? " compact" : "");
  c.innerHTML = "";
  renderFolderActions(); // +New / +Add live outside the scroll box
  const f = normalize(folderFilter);
  const makeMain = folderView === "list" ? makeMainRow : makeMainChip;
  const makeDest = folderView === "list" ? makeDestRow : makeDestChip;
  if (!f || normalize(t("main_folder")).includes(f)) c.appendChild(makeMain());
  const shown = visibleDestinations();
  shown.forEach(d => c.appendChild(makeDest(d)));
  const clr = $("folderFilterClear");
  if (clr) clr.style.display = folderFilter ? "" : "none";
  if (f) {
    const mainShown = !f || normalize(t("main_folder")).includes(f);
    if (!shown.length && !mainShown) {
      const none = document.createElement("div");
      none.className = "no-match"; none.textContent = t("filter_none");
      c.appendChild(none);
    }
  }
  if (keep) {
    const host = [...c.querySelectorAll(".chip,.frow")].find(h =>
      keep.fav !== undefined ? h.dataset.favPath === keep.fav : (keep.folder !== undefined && h.dataset.folder === keep.folder));
    const target = host && ((keep.pin && host.querySelector(".pin")) || host.querySelector(".dest-main"));
    if (target) target.focus();
  }
}

// Folder chips/rows: the selectable part is a real <button> (name = folder name, aria-pressed = selected) and the
// pin star is its own button-role control, so nothing interactive is nested inside another interactive control.
function a11yDest(el, { selected, disabled }) {
  const pin = el.querySelector(".pin");
  const main = document.createElement("button");
  main.type = "button"; main.className = "dest-main";
  while (el.firstChild && el.firstChild !== pin) main.appendChild(el.firstChild);
  el.insertBefore(main, pin);
  main.setAttribute("aria-pressed", String(!!selected));
  if (disabled) main.setAttribute("aria-disabled", "true");
  if (el.dataset.favPath && el.title) main.setAttribute("aria-description", el.title);   // the folder path
  main.querySelectorAll(".sw,.ext").forEach(n => n.setAttribute("aria-hidden", "true"));
  if (pin) {
    pin.setAttribute("role", "button"); pin.tabIndex = 0;
    pin.setAttribute("aria-label", pin.title);                  // "Fijar arriba" / "Quitar de fijadas" (localized)
    pin.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); pin.click(); }
    });
  }
}

// +New folder / +Add folder — rendered in a fixed row outside the scroll box.
function renderFolderActions() {
  const a = $("folderActions"); if (!a) return;
  a.innerHTML = "";
  const addFolder = document.createElement("button");
  addFolder.type = "button";
  addFolder.className = "chip add"; addFolder.textContent = t("new_folder");
  addFolder.onclick = startAddFolder;
  a.appendChild(addFolder);
  const addFav = document.createElement("button");
  addFav.type = "button";
  addFav.className = "chip add"; addFav.textContent = t("add_fav");
  addFav.onclick = async () => {
    const r = await api.addFavorite();
    if (!r.ok && r.duplicate) { flashMsg(t("fav_duplicate").replace("{name}", r.name), "err"); return; }
    if (r.ok) {
      const id = "p:" + r.path;
      if (!pinnedSet.has(id)) { pinnedSet.add(id); await api.togglePin(id); }
      await refreshFavorites();
    }
  };
  a.appendChild(addFav);
}

function clearFolderFilter() {
  folderFilter = "";
  const inp = $("folderFilter");
  if (inp) inp.value = "";
  renderDestinations();
}

async function togglePin(d) {
  const id = destId(d);
  if (pinnedSet.has(id)) pinnedSet.delete(id); else pinnedSet.add(id);
  await api.togglePin(id);
  renderDestinations();
}

function startAddFolder() {
  const a = $("folderActions"); if (!a) return;
  if (a.querySelector(".chip-input")) { a.querySelector(".chip-input input").focus(); return; }
  a.innerHTML = ""; // replace the +New/+Add buttons with the inline name input
  const wrap = document.createElement("div");
  wrap.className = "chip add chip-input";
  const inp = document.createElement("input");
  inp.placeholder = t("name_ph");
  inp.style.cssText = "background:transparent;border:0;outline:0;color:var(--text);font-size:14px;font-weight:600;width:140px;padding:0";
  wrap.appendChild(inp);
  a.appendChild(wrap);
  inp.focus();
  inp.setAttribute("aria-label", t("name_ph"));
  let done = false, busy = false;
  const clearErr = () => {
    inp.removeAttribute("aria-invalid");
    const m = $("msg");
    if (m.dataset.folderErr) { m.className = ""; m.textContent = ""; delete m.dataset.folderErr; }
  };
  const commit = async (viaEnter) => {
    if (done || busy) return;
    const name = inp.value.trim();
    if (!name) { done = true; clearErr(); renderFolderActions(); return; }
    busy = true;
    const res = await tryCreateFolder(name);
    busy = false;
    if (!res.ok) {
      // Keep the previous destination, keep the typed name open for correction.
      const m = $("msg"); m.className = "err"; m.textContent = res.message; m.dataset.folderErr = "1";
      inp.setAttribute("aria-invalid", "true"); inp.setAttribute("aria-describedby", "msg");
      if (viaEnter) { inp.focus(); inp.select(); }
      return;
    }
    done = true; clearErr();
    await refreshFolders(); setTarget(name);
  };
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); commit(true); }
    else if (e.key === "Escape") { done = true; clearErr(); renderFolderActions(); }
  });
  inp.addEventListener("input", clearErr);
  inp.addEventListener("blur", () => commit(false));
}

// Create a subfolder. Returns { ok:true } or { ok:false, message } where message is
// localized; callers must NOT select the folder unless ok (it may not exist).
async function tryCreateFolder(name) {
  let r;
  try { r = await api.createFolder(name); } catch (_) { r = null; }
  if (r && r.ok) return { ok: true };
  return { ok: false, message: t(r && r.error === "invalid name" ? "folder_name_bad" : "folder_create_failed") };
}

function makeMainChip() {
  const col = colorFor("");
  const isActive = !currentFav && currentTarget === "";
  const el = document.createElement("div");
  el.className = "chip" + (isActive ? " active" : "");
  el.style.color = col;
  el.dataset.folder = "";
  el.title = t("main_folder");
  el.innerHTML = `<span class="sw" style="background:${col}"></span>` +
    `<span class="name">${escapeHtml(t("main_folder"))}</span>`;
  el.onclick = () => setTarget("");
  el.addEventListener("contextmenu", (e) => showCtxMenu(e, "", "root"));
  a11yDest(el, { selected: isActive });
  return el;
}

function makeDestChip(d) {
  const isFav = d.kind === "fav";
  const col = colorFor(isFav ? d.name : d.value);
  const isActive = isFav
    ? (currentFav && currentFav.path === d.path)
    : (!currentFav && d.value === currentTarget);
  const el = document.createElement("div");
  el.className = "chip" + (isActive ? " active" : "") + (d.available === false ? " missing" : "");
  el.style.color = col;
  if (isFav) {
    el.dataset.favPath = d.path;
    el.title = (d.available === false ? t("fav_missing") + "\n" : "") + d.path;
  } else {
    el.dataset.folder = d.value;
    el.title = d.name;
  }
  const ext = isFav ? `<span class="ext" title="${escapeHtml(d.path)}">↗</span>` : "";
  const pinTitle = d.pinned ? t("unpin_title") : t("pin_title");
  el.innerHTML =
    `<span class="sw" style="background:${col}"></span>` +
    `<span class="name">${escapeHtml(d.name)}</span>` + ext +
    `<span class="pin${d.pinned ? " pinned" : ""}" title="${pinTitle}">${d.pinned ? "★" : "☆"}</span>`;
  el.onclick = () => {
    if (d.available === false) return;
    isFav ? setFavTarget({ name: d.name, path: d.path }) : setTarget(d.value);
  };
  el.querySelector(".pin").onclick = (e) => { e.stopPropagation(); togglePin(d); };
  el.addEventListener("contextmenu", (e) => showCtxMenu(e, isFav ? d.path : d.value, isFav ? "fav" : "root"));
  a11yDest(el, { selected: isActive, disabled: d.available === false });
  return el;
}

// ---- list-view rows (same data + actions as chips, denser + file counts) ----
function countLabel(id) {
  const n = folderCounts[id];
  return (n == null) ? "" : `<span class="frow-count">${n} ${escapeHtml(t("files_label"))}</span>`;
}

function makeMainRow() {
  const col = colorFor("");
  const isActive = !currentFav && currentTarget === "";
  const el = document.createElement("div");
  el.className = "frow" + (isActive ? " active" : "");
  el.style.color = col;
  el.dataset.folder = "";
  el.title = t("main_folder");
  el.innerHTML =
    `<span class="sw" style="background:${col}"></span>` +
    `<span class="frow-name">${escapeHtml(t("main_folder"))}</span>` +
    countLabel("main");
  el.onclick = () => setTarget("");
  el.addEventListener("contextmenu", (e) => showCtxMenu(e, "", "root"));
  a11yDest(el, { selected: isActive });
  return el;
}

function makeDestRow(d) {
  const isFav = d.kind === "fav";
  const col = colorFor(isFav ? d.name : d.value);
  const isActive = isFav
    ? (currentFav && currentFav.path === d.path)
    : (!currentFav && d.value === currentTarget);
  const el = document.createElement("div");
  el.className = "frow" + (isActive ? " active" : "") + (d.available === false ? " missing" : "");
  el.style.color = col;
  if (isFav) {
    el.dataset.favPath = d.path;
    el.title = (d.available === false ? t("fav_missing") + "\n" : "") + d.path;
  } else {
    el.dataset.folder = d.value;
    el.title = d.name;
  }
  const ext = isFav ? `<span class="ext" title="${escapeHtml(d.path)}">↗</span>` : "";
  const pinTitle = d.pinned ? t("unpin_title") : t("pin_title");
  el.innerHTML =
    `<span class="sw" style="background:${col}"></span>` +
    `<span class="frow-name">${escapeHtml(d.name)}</span>` +
    countLabel(destId(d)) + ext +
    `<span class="pin${d.pinned ? " pinned" : ""}" title="${pinTitle}">${d.pinned ? "★" : "☆"}</span>`;
  el.onclick = () => {
    if (d.available === false) return;
    isFav ? setFavTarget({ name: d.name, path: d.path }) : setTarget(d.value);
  };
  el.querySelector(".pin").onclick = (e) => { e.stopPropagation(); togglePin(d); };
  el.addEventListener("contextmenu", (e) => showCtxMenu(e, isFav ? d.path : d.value, isFav ? "fav" : "root"));
  a11yDest(el, { selected: isActive, disabled: d.available === false });
  return el;
}

// ---- folder view toggle (chips / list) ----
function setFolderView(v) {
  folderView = v === "list" ? "list" : "chips";
  if ($("viewChips")) $("viewChips").classList.toggle("active", folderView === "chips");
  if ($("viewList")) $("viewList").classList.toggle("active", folderView === "list");
  renderDestinations();
  api.setFolderView(folderView);
}
$("viewChips").onclick = () => setFolderView("chips");
$("viewList").onclick = () => setFolderView("list");

function setFolderDensity(v) {
  folderDensity = v === "comfortable" ? "comfortable" : "compact";
  if ($("densCompact")) $("densCompact").classList.toggle("active", folderDensity === "compact");
  if ($("densComfort")) $("densComfort").classList.toggle("active", folderDensity === "comfortable");
  renderDestinations();
  api.setFolderDensity(folderDensity);
}
$("densCompact").onclick = () => setFolderDensity("compact");
$("densComfort").onclick = () => setFolderDensity("comfortable");

function syncHidden() {
  const sel = $("targetFolder");
  sel.innerHTML = '<option value="">(main folder)</option>';
  knownFolders.forEach(name => {
    const o = document.createElement("option"); o.value = name; o.textContent = name; sel.appendChild(o);
  });
  sel.value = currentTarget;
}
function setTarget(name) {
  currentTarget = name;
  currentFav = null;
  $("targetFolder").value = name;
  folderFilter = ""; if ($("folderFilter")) $("folderFilter").value = "";
  renderDestinations();
  syncHint();
}
function setFavTarget(fav) {
  currentFav = { name: fav.name, path: fav.path };
  currentTarget = "";
  $("targetFolder").value = "";
  folderFilter = ""; if ($("folderFilter")) $("folderFilter").value = "";
  renderDestinations();
  syncHint();
}
function syncHint() {
  const name = currentFav
    ? currentFav.name
    : (currentTarget || mainFolderName || t("main_folder_lc"));
  $("goFolder").textContent = name;
  const sw = $("dockSw");
  if (sw) sw.style.background = colorFor(currentFav ? currentFav.name : (currentTarget || mainFolderName));
  updateDockSummary();
}

// ---- manage folders (settings modal) ----
function renderManage() {
  const m = $("mngList"); if (!m) return;
  if (!knownFolders.length) { m.innerHTML = `<div class="mng-empty">${t("no_folders")}</div>`; return; }
  m.innerHTML = "";
  knownFolders.forEach(name => {
    const row = document.createElement("div"); row.className = "mng-item";
    row.innerHTML = `<span class="sw" style="background:${colorFor(name)}"></span><span class="mng-name">${escapeHtml(name)}</span>`;
    const ren = document.createElement("button"); ren.className = "sec mini"; ren.textContent = t("rename");
    ren.onclick = () => startRename(row, name);
    const rem = document.createElement("button"); rem.className = "sec mini"; rem.textContent = t("remove");
    rem.onclick = async () => {
      if (!confirm(t("remove_confirm").replace("{name}", name))) return;
      await api.removeFolder(name);
      if (currentTarget === name) currentTarget = "";
      await refreshFolders();
    };
    row.appendChild(ren); row.appendChild(rem);
    m.appendChild(row);
  });
}
function focusManageRow(name) {   // keyboard users keep their place after a rename is cancelled / saved
  const r = [...document.querySelectorAll("#mngList .mng-item")].find(x => x.querySelector(".mng-name") && x.querySelector(".mng-name").textContent === name);
  const b = r && r.querySelector("button"); if (b && $("settings").classList.contains("show")) b.focus();
}
function startRename(row, oldName) {
  const nameEl = row.querySelector(".mng-name");
  const inp = document.createElement("input");
  inp.value = oldName; inp.className = "mng-rename";
  nameEl.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const commit = async () => {
    if (done) return; done = true;
    const nn = inp.value.trim();
    if (nn && nn !== oldName) {
      const r = await api.renameFolder({ oldName, newName: nn });
      if (r && r.ok && currentTarget === oldName) currentTarget = nn;
    }
    await refreshFolders(); renderManage();
    if (kbd) focusManageRow(nn && nn !== oldName ? nn : oldName);
  };
  let kbd = false;
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); kbd = true; commit(); }
    else if (e.key === "Escape") { done = true; renderManage(); focusManageRow(oldName); }
  });
  inp.addEventListener("blur", commit);
}

// ---- history ----
function prettyDetails(d) {
  if (!d) return "";
  if (d === "original") return t("badge_orig");
  if (d.startsWith("quality=")) { const q = d.slice(8); return q === "best" ? t("badge_best") : q + "p"; }
  const m = d.match(/^(\w+)\s+(\d+)kbps$/);
  if (m) { const fmt = m[1].toUpperCase(); return (fmt === "WAV" || fmt === "FLAC") ? fmt : `${fmt} · ${m[2]} kbps`; }
  return d;
}
function lastSeg(p) { return p ? p.split("/").filter(Boolean).pop() : ""; }

async function refreshHistory() {
  clearHistMsg();
  const rows = await api.getHistory({ limit: 50 });
  const body = $("histBody");
  if (!rows.length) { body.innerHTML = `<div class="empty">${t("hist_empty")}</div>`; return; }
  body.innerHTML = "";
  rows.forEach(r => {
    const div = document.createElement("div");
    div.className = "item";
    const when = SelektTime.formatHistoryTime(r.time);   // stored UTC -> this computer's local time ("" if missing/invalid)
    const folderName = lastSeg(r.folder);
    const det = prettyDetails(r.details);
    div.innerHTML = `<span class="sw" style="background:${colorFor(folderName)}"></span>
      <div class="meta">
        <div class="t">${escapeHtml(r.title || "")}</div>
        <div class="f">${det ? `<span class="badge">${escapeHtml(det)}</span>` : ""}${escapeHtml(folderName)}${when ? " · " + when : ""}</div>
      </div>`;
    const acts = document.createElement("div"); acts.className = "acts";
    const play = document.createElement("button"); play.className = "sec"; play.textContent = "▶ " + t("play");
    play.onclick = () => runOpenAction(() => api.openFile(r.file), "hist", "file");
    const show = document.createElement("button"); show.className = "sec"; show.textContent = t("show");
    show.onclick = () => runOpenAction(() => api.reveal(r.file), "hist", "file");
    acts.appendChild(play); acts.appendChild(show);
    if (r.url) {
      const copy = document.createElement("button"); copy.className = "sec"; copy.textContent = "🔗 " + t("copy_link");
      copy.onclick = () => {
        api.copyText(r.url);
        copy.textContent = "✓ " + t("copied");
        setTimeout(() => { copy.textContent = "🔗 " + t("copy_link"); }, 1800);
      };
      acts.appendChild(copy);
    }
    div.appendChild(acts);
    body.appendChild(div);
  });
}

$("clearHist").onclick = async () => {
  if (!confirm(t("clear_hist_confirm"))) return;
  await api.clearHistory();
  refreshHistory();
};

// ---- tabs ----
document.querySelectorAll(".tab").forEach(t0 => {
  t0.onclick = () => {
    const which = t0.dataset.tab;
    $("tab-dl").style.display    = which === "dl"    ? "block" : "none";
    $("tab-hist").style.display  = which === "hist"  ? "block" : "none";
    $("tab-queue").style.display = which === "queue" ? "block" : "none";
    document.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-selected", "false"));
    t0.setAttribute("aria-selected", "true");
    if (which === "hist")  refreshHistory();
    if (which === "queue") renderQueue();
  };
});

// ---- language toggle ----
$("langBtn").onclick = async () => {
  LANG = LANG === "es" ? "en" : "es";
  await api.setLang(LANG);
  applyI18n();
};

// ---- settings modal ----
// While Settings is open the page behind it is inert (no Tab, no screen-reader access); focus moves into the dialog on
// open and goes back to the control that opened it on close. Escape closes it; Tab/Shift+Tab wrap inside it.
let settingsReturnFocus = null;
function setBackgroundInert(on) {
  [...document.body.children].forEach(el => { if (el.id !== "settings" && el.tagName !== "SCRIPT") el.inert = on; });
}
function openSettings() {
  settingsReturnFocus = document.activeElement;
  setBackgroundInert(true);
  $("settings").classList.add("show");
  renderManage();
  refreshWatchSettings();
  refreshFingerprintSettings();
  $("settings").querySelector(".modal").focus();
}
function closeSettings() {
  if (!$("settings").classList.contains("show")) return;
  $("settings").classList.remove("show");
  setBackgroundInert(false);
  const back = (settingsReturnFocus && document.contains(settingsReturnFocus)) ? settingsReturnFocus : $("openSettingsBtn");
  settingsReturnFocus = null;
  back.focus();
}
$("openSettingsBtn").onclick = openSettings;
$("closeSettingsBtn").onclick = closeSettings;
$("settings").addEventListener("click", e => { if (e.target.id === "settings") closeSettings(); });
document.addEventListener("keydown", e => {
  if (!$("settings").classList.contains("show")) return;
  if (e.key === "Escape") {
    if (e.target.classList && e.target.classList.contains("mng-rename")) return;   // inline rename: Escape cancels the rename only
    e.preventDefault(); closeSettings(); return;
  }
  if (e.key !== "Tab") return;
  const modal = $("settings").querySelector(".modal");
  const f = [...modal.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.getClientRects().length);
  if (!f.length) { e.preventDefault(); return; }
  const first = f[0], last = f[f.length - 1], a = document.activeElement;
  if (!modal.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }   // focus was dropped (e.g. a list re-rendered)
  else if (e.shiftKey && (a === first || a === modal)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
});

// ---- main folder actions ----
$("pickMain").onclick = async () => {
  const p = await api.pickMainFolder();
  if (!p) return;
  await api.setMainFolder(p);
  await refreshSettings();
  await refreshFolders();
};
$("openMain").onclick = () => api.openMainFolder();

$("createFolder").onclick = async () => {
  const name = $("folderName").value.trim();
  if (!name) return;
  const res = await tryCreateFolder(name);
  if (!res.ok) {
    // Keep the typed name and the previous destination; say why, next to the field.
    $("folderNameErr").textContent = res.message;
    $("folderName").setAttribute("aria-invalid", "true");
    $("folderName").focus();
    return;
  }
  $("folderNameErr").textContent = "";
  $("folderName").removeAttribute("aria-invalid");
  $("folderName").value = "";
  await refreshFolders();
  setTarget(name);
};
$("folderName").addEventListener("input", () => {
  $("folderNameErr").textContent = "";
  $("folderName").removeAttribute("aria-invalid");
});
$("folderName").addEventListener("keydown", e => { if (e.key === "Enter") $("createFolder").click(); });

// ---- paste button ----
$("pasteBtn").onclick = async () => {
  const txt = ((await api.pasteText()) || "").trim();
  if (!txt) { flashMsg(t("paste_empty"), "err"); return; }
  $("url").value = txt;
  $("url").focus();
  triggerPreview(txt);
};
function flashMsg(text, cls, ms) {
  const msg = $("msg"); msg.className = cls || ""; msg.textContent = text;
  setTimeout(() => { if (msg.textContent === text) { msg.className = ""; msg.textContent = ""; } }, ms || 2500);
}

// Normalize was requested but did not complete for some files (main sends r.normalizeWarning; the files are kept as downloaded).
function normWarnText(w) {
  if (!w || !Array.isArray(w.failed) || !w.failed.length) return "";
  const known = ["measure", "apply", "replace"];
  const why = [...new Set(w.failed.map(f => t("norm_reason_" + (known.includes(f && f.reason) ? f.reason : "error"))))].join("; ");
  return t("norm_warn").replace("{n}", w.failed.length).replace("{total}", w.total || w.failed.length).replace("{reason}", why);
}

// Cancelled while normalizing, with finished files left in the folder (main sends keptFiles, and which of them were
// normalized before the cancel: normalizedFiles). Says what is true per file: none / some / all were normalized.
// Returns "" when no file was kept (then the plain "cancelled" text applies).
function canceledNote(r) {
  const kept = r && Array.isArray(r.keptFiles) ? r.keptFiles.length : 0;
  if (!kept) return "";
  const done = Array.isArray(r.normalizedFiles) ? r.normalizedFiles.length : 0;
  if (done <= 0) return t("q_canceled_kept");
  const rest = kept - done;
  if (rest <= 0) return t("q_canceled_all").replace("{total}", kept);
  return t("q_canceled_partial").replace("{done}", done).replace("{total}", kept);
}

// ---- open / reveal / trash results (main returns { ok:true } or { ok:false, code }) ----
function h1Message(r, kind) {
  const code = r && r.code;
  if (kind === "trash") {   // every rejected trash says "not deleted", except a duplicate request for one already running
    return t(code === "missing" ? "h1_missing" : code === "in_progress" ? "h1_trash_busy" : "h1_trash_failed");
  }
  if (code === "outside") return t("h1_outside");
  if (code === "missing") return t(kind === "folder" ? "h1_folder_missing" : "h1_missing");
  if (code === "trash_failed") return t("h1_trash_failed");
  if (code === "not_allowed") return t("h1_not_allowed");
  return t("h1_failed");
}
// Runs an api call that opens/reveals/trashes; on rejection shows the localized error
// in `where` ("hist" = alert region in the History tab, otherwise the dock status line).
// Returns true when main reported success.
async function runOpenAction(call, where, kind) {
  let r;
  try { r = await call(); } catch (_) { r = { ok: false }; }
  if (r && r.ok === true) {
    if (where === "hist") clearHistMsg();
    else { const m = $("msg"); if (m.dataset.h1 && m.textContent === m.dataset.h1) { m.className = ""; m.textContent = ""; } delete m.dataset.h1; }   // a retry that worked clears its own earlier error
    return true;
  }
  const text = h1Message(r, kind);
  if (where === "hist") { const el = $("histMsg"); el.textContent = text; }
  else { flashMsg(text, "err", 8000); $("msg").dataset.h1 = text; }
  return false;
}
function clearHistMsg() { const el = $("histMsg"); if (el) el.textContent = ""; }

$("url").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("go").click(); } });

// ---- folder type-to-filter ----
$("folderFilter").addEventListener("input", () => {
  folderFilter = $("folderFilter").value;
  renderDestinations();
});
$("folderFilter").addEventListener("keydown", e => {
  if (e.key === "Escape") { e.preventDefault(); clearFolderFilter(); }
  else if (e.key === "Enter") {
    e.preventDefault();
    const top = visibleDestinations().find(d => d.available !== false);
    if (top) { top.kind === "fav" ? setFavTarget({ name: top.name, path: top.path }) : setTarget(top.value); }
    else if (!folderFilter || normalize(t("main_folder")).includes(normalize(folderFilter))) setTarget("");
  }
});
$("folderFilterClear").onclick = () => { clearFolderFilter(); $("folderFilter").focus(); };

// ---- dock recipe summary: format + quality + target + active toggles ----
// Mirrors exactly what pressing Download will do for THIS download.
function updateDockSummary() {
  const box = $("dockChips");
  if (!box) return;
  const chips = [];
  const optTxt = (sel) => { const o = $(sel) && $(sel).selectedOptions[0]; return o ? o.textContent.trim() : ""; };

  // format (always)
  const fmt = optTxt("format"); if (fmt) chips.push({ t: fmt, c: "" });
  // audio quality — only when the bitrate control is relevant (lossy audio)
  if ($("bitrateWrap") && $("bitrateWrap").style.display !== "none") {
    const bq = optTxt("bitrate"); if (bq) chips.push({ t: bq, c: "" });
  }
  // loudness target — only when Normalize is on (its select is shown)
  if ($("lufsWrap") && $("lufsWrap").style.display !== "none") {
    const lf = optTxt("lufsSelect"); if (lf) chips.push({ t: lf, c: "" });
  }
  // toggles — show a badge only when ENABLED; label comes from the toggle itself (localized)
  const togChip = (id, cls) => {
    const b = $(id);
    if (b && b.classList.contains("active")) {
      const lbl = b.querySelector("span:not(.sw)");
      chips.push({ t: lbl ? lbl.textContent.trim() : id, c: cls });
    }
  };
  togChip("playlistToggle", "list");   // whole-list / playlist — highlighted, changes behavior
  togChip("dupToggle", "on");
  togChip("autoTagToggle", "on");
  togChip("loudnormToggle", "on");

  box.innerHTML = chips.map(c => `<span class="dock-chip ${c.c}">${escapeHtml(c.t)}</span>`).join("");
}

// ---- bitrate visibility ----
function updateBitrateVis() {
  const v = $("format").value;
  const lossy = v === "audio:mp3" || v === "audio:m4a";
  $("bitrateWrap").style.display = lossy ? "" : "none";
  updateDockSummary();
}
$("format").addEventListener("change", () => {
  updateBitrateVis();
  api.setAudioFormat($("format").value);
});
$("bitrate").addEventListener("change", () => {
  updateDockSummary();
  api.setAudioBitrate($("bitrate").value);
});
updateBitrateVis();

// ---- playlist toggle ----
let playlistOn = false;
$("playlistToggle").onclick = () => {
  playlistOn = !playlistOn;
  $("playlistToggle").classList.toggle("active", playlistOn);
  $("playlistToggle").setAttribute("aria-pressed", String(playlistOn));
  updateDockSummary();
};

// ---- duplicate prevention toggle ----
$("dupToggle").onclick = async () => {
  preventDuplicates = !preventDuplicates;
  $("dupToggle").classList.toggle("active", preventDuplicates);
  $("dupToggle").setAttribute("aria-pressed", String(preventDuplicates));
  updateDockSummary();
  await api.setPreventDuplicates(preventDuplicates);
};

// ---- auto-tag toggle ----
$("autoTagToggle").onclick = async () => {
  autoTagEnabled = !autoTagEnabled;
  $("autoTagToggle").classList.toggle("active", autoTagEnabled);
  $("autoTagToggle").setAttribute("aria-pressed", String(autoTagEnabled));
  updateDockSummary();
  await api.setAutoTag(autoTagEnabled);
};

// ---- loudnorm toggle ----
$("loudnormToggle").onclick = async () => {
  loudnormEnabled = !loudnormEnabled;
  $("loudnormToggle").classList.toggle("active", loudnormEnabled);
  $("loudnormToggle").setAttribute("aria-pressed", String(loudnormEnabled));
  $("lufsWrap").style.display = loudnormEnabled ? "" : "none";
  updateDockSummary();
  await api.setLoudnorm(loudnormEnabled);
};
$("lufsSelect").addEventListener("change", async () => {
  lufsValue = Number($("lufsSelect").value) || -14;
  updateDockSummary();
  await api.setLufs(lufsValue);
});

// ---- cookies-from-browser ----
$("cookiesBrowser").addEventListener("change", async () => {
  await api.setCookiesBrowser($("cookiesBrowser").value);
});

// ---- duplicate warning ----
$("dupForce").onclick = async () => {
  hideDupWarning();
  if (pendingDupOpts) await runDownload(pendingDupOpts);
};
$("dupCancel").onclick = () => { hideDupWarning(); pendingDupOpts = null; };
function hideDupWarning() { $("dupWarning").style.display = "none"; }
function showDupWarning(r, opts) {
  pendingDupOpts = { ...opts, force: true };
  $("dupTitle").textContent = r.title || r.id || "";
  $("dupFile").textContent = r.existing[0] ? r.existing[0].split("/").pop() : "";
  $("dupWarning").style.display = "block";
}

// ---- folder chip right-click context menu ----
let ctxFolder = "", ctxType = "root";
function showCtxMenu(e, value, type = "root") {
  e.preventDefault(); e.stopPropagation();
  ctxFolder = value; ctxType = type;
  $("ctxOpenLabel").textContent = t("open_folder");
  if (type === "fav") {
    const favInfo = knownFavs.find(f => f.path === value);
    $("ctxRename").style.display = "none";
    $("ctxRemove").style.display = "none";
    $("ctxDivider").style.display = "";
    $("ctxFavRemove").style.display = "";
    $("ctxOpen").style.opacity = (favInfo && favInfo.available === false) ? "0.4" : "1";
    $("ctxOpen").style.pointerEvents = (favInfo && favInfo.available === false) ? "none" : "";
  } else {
    const isMain = value === "";
    $("ctxRename").style.display = isMain ? "none" : "";
    $("ctxRemove").style.display = isMain ? "none" : "";
    $("ctxDivider").style.display = isMain ? "none" : "";
    $("ctxFavRemove").style.display = "none";
    $("ctxOpen").style.opacity = ""; $("ctxOpen").style.pointerEvents = "";
  }
  const menu = $("ctxMenu");
  menu.style.display = "block";
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.min(e.clientX, window.innerWidth  - mw - 6) + "px";
  menu.style.top  = Math.min(e.clientY, window.innerHeight - mh - 6) + "px";
}
function hideCtxMenu() { $("ctxMenu").style.display = "none"; }
document.addEventListener("click", hideCtxMenu);
document.addEventListener("contextmenu", (e) => {
  if (!e.target.closest("[data-folder]") && !e.target.closest("[data-fav-path]")) hideCtxMenu();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideCtxMenu(); });

$("ctxOpen").onclick = (e) => {
  e.stopPropagation(); hideCtxMenu();
  if (ctxType === "fav") runOpenAction(() => api.openFavorite(ctxFolder), "dock", "folder");
  else runOpenAction(() => api.openFolder(ctxFolder), "dock", "folder");
};
$("ctxRename").onclick = (e) => {
  e.stopPropagation(); hideCtxMenu();
  startChipRename(ctxFolder);
};
$("ctxRemove").onclick = async (e) => {
  e.stopPropagation(); hideCtxMenu();
  if (!confirm(t("remove_confirm").replace("{name}", ctxFolder))) return;
  await api.removeFolder(ctxFolder);
  if (currentTarget === ctxFolder) currentTarget = "";
  await refreshFolders();
};
$("ctxFavRemove").onclick = async (e) => {
  e.stopPropagation(); hideCtxMenu();
  const fav = knownFavs.find(f => f.path === ctxFolder);
  const name = fav ? fav.name : ctxFolder.split("/").pop();
  if (!confirm(t("fav_remove_confirm").replace("{name}", name))) return;
  await api.removeFavorite(ctxFolder);
  if (currentFav && currentFav.path === ctxFolder) { currentFav = null; syncHint(); }
  await refreshFavorites();
};

function startChipRename(name) {
  const chip = document.querySelector(`[data-folder="${CSS.escape(name)}"]`);
  if (!chip) return;
  chip.innerHTML = "";
  const inp = document.createElement("input");
  inp.value = name;
  inp.style.cssText = "background:transparent;border:0;outline:0;color:var(--text);font-size:14px;font-weight:600;width:140px;padding:0";
  chip.appendChild(inp);
  inp.focus(); inp.select();
  let done = false;
  const commit = async () => {
    if (done) return; done = true;
    const nn = inp.value.trim();
    if (nn && nn !== name) {
      const r = await api.renameFolder({ oldName: name, newName: nn });
      if (r && r.ok && currentTarget === name) currentTarget = nn;
    }
    await refreshFolders();
  };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { done = true; refreshFolders(); }
  });
  inp.addEventListener("blur", commit);
}

// ---- link preview ----
let previewVersion = 0;
let previewDebounce = null;

function fmtDur(s) {
  if (!s) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h
    ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`
    : `${m}:${String(sec).padStart(2,"0")}`;
}

function hidePreview() {
  $("linkPreview").style.display = "none";
  $("prevLoading").style.display = "none";
  $("prevData").style.display = "none";
  $("prevQuality").style.display = "none";
  $("suggestBar").style.display = "none";
  lastProbe = null;
}

async function triggerPreview(url) {
  if (!url || !url.startsWith("http")) { hidePreview(); return; }
  const v = ++previewVersion;
  $("linkPreview").style.display = "block";
  $("prevLoading").style.display = "flex";
  $("prevData").style.display = "none";

  const r = await api.getInfo(url);
  if (v !== previewVersion) return;

  $("prevLoading").style.display = "none";
  if (!r.ok) { hidePreview(); return; }

  lastProbe = r;
  $("prevTitle").textContent = r.title || "";
  const parts = [];
  if (r.uploader) parts.push(r.uploader);
  if (r.duration) parts.push(fmtDur(r.duration));
  $("prevMeta").textContent = parts.join(" · ");

  if (r.sourceAbr) {
    const asr = r.sourceAsr ? ` ${Math.round(r.sourceAsr / 1000)} kHz` : "";
    $("prevQuality").textContent = `${t("src_quality")}: ~${Math.round(r.sourceAbr)} kbps ${r.sourceAcodec || ""}${asr}`.trim();
    $("prevQuality").style.display = "";
  } else {
    $("prevQuality").style.display = "none";
  }

  if (r.thumbnail) {
    $("prevThumb").src = r.thumbnail;
    $("prevThumb").style.display = "";
    $("prevThumbFb").style.display = "none";
  } else {
    $("prevThumb").style.display = "none";
    $("prevThumbFb").style.display = "flex";
  }
  $("prevData").style.display = "flex";

  const cfg = await api.getSettings();
  if (cfg.suggest_folder !== false) {
    const sug = suggestFolder(r);
    if (sug && sug !== currentTarget) {
      $("suggestChip").textContent = `${t("suggest_prefix")} ${sug}`;
      $("suggestChip").onclick = () => { setTarget(sug); $("suggestBar").style.display = "none"; };
      $("suggestBar").style.display = "";
    } else {
      $("suggestBar").style.display = "none";
    }
  }
}

$("prevClose").onclick = () => { previewVersion++; hidePreview(); };

$("url").addEventListener("input", () => {
  clearTimeout(previewDebounce);
  const url = $("url").value.trim();
  if (!url) { previewVersion++; hidePreview(); return; }
  if (!url.startsWith("http")) return;
  previewDebounce = setTimeout(() => triggerPreview(url), 1000);
});

// ---- progress bar helpers ----
function resetBar(pct = 0) {
  $("bar").querySelector("i").style.width = pct + "%";
  $("dlPct").textContent   = pct ? pct + "%" : "";
  $("dlSpeed").textContent = "";
  $("dlEta").textContent   = "";
}
function hideBar() {
  $("barWrap").style.display = "none";
  resetBar(0);
  $("dlPhase").textContent = "";
}

// ---- single download ----
async function runDownload(opts) {
  const msg = $("msg");
  msg.className = ""; msg.textContent = "";
  hideDupWarning();
  previewVersion++; hidePreview(); hideBar();
  $("go").disabled = true; $("go").textContent = t("go_downloading");
  resetBar(0); $("barWrap").style.display = "block";
  $("dlPhase").textContent = ""; $("dlPct").textContent = "0%";
  const r = await api.download(opts);
  $("go").disabled = false; $("go").textContent = t("go");
  if (r.duplicate) { hideBar(); showDupWarning(r, opts); return; }
  if (r.ok) {
    resetBar(100);
    const warn = normWarnText(r.normalizeWarning);
    if (warn) {
      msg.className = "warn";
      msg.textContent = warn + " " + t("norm_warn_in").replace("{folder}", lastSeg(r.folder) || t("main_folder_lc"));
    } else {
      msg.className = "ok";
      msg.textContent = t("done_msg").replace("{n}", r.count).replace("{folder}", lastSeg(r.folder) || t("main_folder_lc"));
    }
    await refreshHistory();
    setTimeout(() => { $("url").value = ""; hideBar(); }, 800);
    if (!warn) setTimeout(() => { msg.className = ""; msg.textContent = ""; }, 3500);   // a warning stays until the next action
  } else if (r.needsCookies) {
    msg.className = "err"; msg.textContent = t("cookies_hint");
    hideBar();
  } else {
    msg.className = "err"; msg.textContent = t("err_pre") + " " + (r.error || t("dl_failed"));
    hideBar();
  }
}

// Download = enqueue (non-blocking) + start the queue. Lets you paste the next
// link and press Download again immediately; items pile up and run in order,
// each remembering the settings active when you pressed.
$("go").onclick = async () => {
  const url = $("url").value.trim();
  const msg = $("msg");
  msg.className = ""; msg.textContent = "";
  if (!url) { msg.className = "err"; msg.textContent = t("no_link"); $("url").focus(); return; }

  // "Download list" on → open the track picker first so the user can deselect
  // tracks. Enqueue happens from the picker's Download button.
  if (playlistOn) { await openPlaylistPicker(url); return; }

  // Keep the quick "lossless from a low-bitrate source" sanity confirm at press time.
  const [kind, val] = $("format").value.split(":");
  const lossless = kind === "audio" && (val === "wav" || val === "flac");
  if (lossless && lastProbe && lastProbe.sourceAbr && lastProbe.sourceAbr < 320) {
    if (!confirm(t("lossless_warn")
      .replace("{abr}", Math.round(lastProbe.sourceAbr))
      .replace("{fmt}", val.toUpperCase())
      .replace("{fmt}", val.toUpperCase()))) return;
  }

  // Pre-queue duplicate check (extension-aware) — flag BEFORE it goes in the
  // queue, only when we know the id and "Avoid duplicates" is on. mp3 vs mp4 of
  // the same link won't trigger this (different extension = different file).
  let force = false;
  if (preventDuplicates && !playlistOn && lastProbe && lastProbe.id) {
    const chk = await api.checkDuplicate({
      id: lastProbe.id,
      folder: currentFav ? undefined : currentTarget,
      targetPath: currentFav ? currentFav.path : undefined,
      type: kind === "audio" ? "audio" : "video",
      audioFormat: kind === "audio" ? val : undefined,
      noConvert: kind === "video" && val === "original",
    });
    if (chk.exists) {
      const folderLabel = currentFav ? currentFav.name : (currentTarget || mainFolderName || t("main_folder_lc"));
      const fmtLabel = $("format").selectedOptions[0]
        ? $("format").selectedOptions[0].textContent.trim()
        : $("format").value;
      if (!confirm(t("dup_preq").replace("{folder}", folderLabel).replace("{format}", fmtLabel))) return; // don't queue
      force = true; // user chose "download anyway"
    }
  }

  await api.queueAdd([buildQueueItemFromSelection(url, force)]);

  // Free the input straight away so the next link can be pasted.
  const where = currentFav ? currentFav.name : (currentTarget || mainFolderName || t("main_folder_lc"));
  $("url").value = ""; previewVersion++; hidePreview();
  $("url").focus();
  flashMsg(t("queued_msg").replace("{folder}", where), "ok");

  if (!queueRunning) runQueue();   // start if idle; already-running picks it up
  else updateActiveCount();        // bump the "N waiting" badge right away
  if ($("tab-queue").style.display !== "none") renderQueue();
};

// ===========================================================================
// PLAYLIST TRACK PICKER — deselect tracks before downloading a list
// ===========================================================================
let plPickerUrl = "", plPickerTitle = "", plPickerEntries = [];
let plProgress = null;   // { itemId, sel:[origIndices], curPos } while a list downloads

function fmtDur(s) {
  if (s == null) return "";
  s = Math.round(s);
  const m = Math.floor(s / 60), ss = String(s % 60).padStart(2, "0");
  return m + ":" + ss;
}

// Fetch the playlist's tracks and open the picker (called from Download when
// "Download list" is on).
async function openPlaylistPicker(url) {
  const msg = $("msg");
  msg.className = ""; msg.textContent = t("pl_loading");
  $("go").disabled = true;
  let res;
  try { res = await api.fetchPlaylist(url); }
  catch (e) { res = { ok: false, error: String(e) }; }
  $("go").disabled = false;
  if (!res || !res.ok) {
    msg.className = "err";
    msg.textContent = t("err_pre") + " " + ((res && res.error) || t("dl_failed"));
    return;
  }
  if (!res.entries || !res.entries.length) { msg.className = "err"; msg.textContent = t("pl_empty"); return; }
  msg.className = ""; msg.textContent = "";
  showPlaylistPicker(url, res);
}

function showPlaylistPicker(url, res) {
  resetPickerToSelectMode();
  plPickerUrl = url;
  plPickerTitle = res.title || "";
  plPickerEntries = res.entries;
  $("plPickSub").textContent = t("pl_pick_sub").replace("{n}", res.count);
  $("plList").innerHTML = plPickerEntries.map(e => `
    <label class="pl-item${e.unavailable ? " unavail" : ""}">
      <input type="checkbox" data-idx="${e.index}" ${e.unavailable ? "disabled" : "checked"}>
      <span class="pl-idx">${e.index}</span>
      <span class="pl-name" title="${escapeHtml(e.title)}">${escapeHtml(e.title)}${e.unavailable ? " (" + t("pl_unavailable") + ")" : ""}</span>
      <span class="pl-dur">${fmtDur(e.duration)}</span>
      <span class="pl-st" id="plst-${e.index}"></span>
    </label>`).join("");
  $("plList").querySelectorAll("input").forEach(cb => cb.addEventListener("change", updatePlSelCount));
  updatePlSelCount();
  $("plPicker").classList.add("show");
}

function selectedPlIndices() {
  return [...$("plList").querySelectorAll("input:checked")].map(cb => parseInt(cb.dataset.idx, 10));
}
function updatePlSelCount() {
  const n = selectedPlIndices().length;
  $("plSelCount").textContent = t("pl_selected").replace("{n}", n);
  $("plDownload").textContent = t("pl_download_sel").replace("{n}", n);
  $("plDownload").disabled = n === 0;
}
function closePlaylistPicker() { $("plPicker").classList.remove("show"); }

// Return the picker to its pre-download (selectable) state.
function resetPickerToSelectMode() {
  plProgress = null;
  $("plDownload").style.display = "";
  $("plCancel").textContent = t("pl_cancel");
  $("plStatus").style.display = "none";
  $("plStatus").className = "pl-status";
  $("plStatus").textContent = "";
}

$("plSelectAll").onclick  = () => { if (plProgress) return; $("plList").querySelectorAll("input:not(:disabled)").forEach(cb => cb.checked = true); updatePlSelCount(); };
$("plSelectNone").onclick = () => { if (plProgress) return; $("plList").querySelectorAll("input").forEach(cb => cb.checked = false); updatePlSelCount(); };
$("plCancel").onclick     = closePlaylistPicker;   // in progress mode this is "Close" — download keeps running
$("plPicker").addEventListener("click", (e) => { if (e.target === $("plPicker")) closePlaylistPicker(); });

// Confirm selection → enqueue, then switch the dialog into live progress mode
// (stays open, shows track-by-track progress, auto-closes when finished).
$("plDownload").onclick = async () => {
  const sel = selectedPlIndices();
  if (!sel.length) return;
  const item = buildQueueItemFromSelection(plPickerUrl, false);
  item.playlist = true;
  item.playlistItems = sel;
  if (plPickerTitle) item.title = plPickerTitle;
  const res = await api.queueAdd([item]);
  const itemId = res && res.items && res.items[0] && res.items[0].id;

  enterPlaylistProgressMode(sel, itemId);

  // Free the Download tab for the next paste; the queue/active card still work
  // even if the user closes this dialog.
  const where = currentFav ? currentFav.name : (currentTarget || mainFolderName || t("main_folder_lc"));
  $("url").value = ""; previewVersion++; hidePreview();
  flashMsg(t("queued_msg").replace("{folder}", where), "ok");
  if (!queueRunning) runQueue(); else updateActiveCount();
  if ($("tab-queue").style.display !== "none") renderQueue();
};

// Lock the list and prep per-track status slots.
function enterPlaylistProgressMode(sel, itemId) {
  plProgress = { itemId, sel, curPos: 0 };
  const selSet = new Set(sel);
  $("plList").querySelectorAll("input").forEach(cb => cb.disabled = true);
  plPickerEntries.forEach(e => {
    const st = $("plst-" + e.index);
    if (!st) return;
    const row = st.closest(".pl-item");
    if (selSet.has(e.index)) { st.textContent = t("pl_st_pending"); st.className = "pl-st"; }
    else { st.textContent = ""; row && row.classList.add("skip"); }
  });
  $("plDownload").style.display = "none";
  $("plCancel").textContent = t("pl_close");
  $("plStatus").style.display = "block";
  $("plStatus").className = "pl-status";
  $("plStatus").textContent = t("pl_status_downloading");
}

// Fed by download-progress events: mark finished tracks, spotlight the current one.
function updatePlaylistProgress(itemPos, pct) {
  if (!plProgress || !itemPos) return;
  const sel = plProgress.sel;
  for (let k = 0; k < itemPos - 1; k++) {
    const st = $("plst-" + sel[k]);
    if (st && !st.classList.contains("done")) {
      st.textContent = "✓"; st.className = "pl-st done";
      const row = st.closest(".pl-item"); if (row) { row.classList.add("done"); row.classList.remove("active"); }
    }
  }
  const st = $("plst-" + sel[itemPos - 1]);
  if (st) {
    st.textContent = (pct > 0) ? Math.round(pct) + "%" : "…";
    st.className = "pl-st cur";
    const row = st.closest(".pl-item");
    if (row) row.classList.add("active");
    if (itemPos !== plProgress.curPos && row) { plProgress.curPos = itemPos; row.scrollIntoView({ block: "nearest" }); }
  }
}

// Called when the queue item for this list finishes (any outcome).
function finishPlaylistProgress(status) {
  if (!plProgress) return;
  plProgress.sel.forEach(idx => {
    const st = $("plst-" + idx);
    if (st && !st.classList.contains("done")) {
      st.textContent = "✓"; st.className = "pl-st done";
      const row = st.closest(".pl-item"); if (row) { row.classList.add("done"); row.classList.remove("active"); }
    }
  });
  const wasOpen = $("plPicker").classList.contains("show");
  plProgress = null;
  $("plStatus").className = "pl-status" + (status === "done" ? " done-c" : "");
  $("plStatus").textContent = status === "done" ? t("pl_status_done") : t("pl_status_ended");
  // Auto-close on a clean finish; on errors leave it open so the user can look.
  if (wasOpen && status === "done") setTimeout(() => { if (!plProgress) closePlaylistPicker(); }, 1400);
}

// ===========================================================================
// FEATURE 1 — QUEUE
// ===========================================================================
let queueRunning = false;
let queuePaused  = false;
let queueActiveId = null;   // id of the currently-running item
let stopAllRequested = false;   // "Stop all" pressed — drop pending items too

// Parse a blob of text into valid http(s) URLs, deduped.
function parseLinks(text) {
  const seen = new Set();
  return (text.match(/https?:\/\/\S+/g) || [])
    .map(u => u.trim())
    .filter(u => !seen.has(u) && seen.add(u));
}

// Build <option> HTML for every destination (main folder + subfolders + favs).
function buildFolderSelectOptions(selectedId = "") {
  let html = `<option value=""${selectedId === "" ? " selected" : ""}>${escapeHtml(t("main_folder"))}</option>`;
  knownFolders.forEach(name => {
    const id = "f:" + name;
    html += `<option value="${escapeHtml(id)}"${selectedId === id ? " selected" : ""}>${escapeHtml(name)}</option>`;
  });
  knownFavs.forEach(f => {
    const id = "p:" + f.path;
    html += `<option value="${escapeHtml(id)}"${selectedId === id ? " selected" : ""}>${escapeHtml(f.name)} ↗</option>`;
  });
  return html;
}

// Folder options for a SAVED destination (the watch destination in Settings, and a Queue row's folder). A saved destination that is no longer in the lists (a favorite that was
// removed, a sub-folder that is gone, a malformed value) is shown as an "unavailable" entry that stays selected, so the
// select never looks like it is set to the main folder when it is not.
function destOptionsHtml(rawDestId) {
  // Absent/null = main folder (the same rule as destination.js). Any other non-string value (false, 0, a number, an
  // object: a damaged queue file or config) is NOT converted to the main folder: it is shown as text, as unavailable.
  const destId = (rawDestId === undefined || rawDestId === null) ? "" : (typeof rawDestId === "string" ? rawDestId : (JSON.stringify(rawDestId) ?? String(rawDestId)));
  let html = buildFolderSelectOptions(destId);
  const offered = destId === "" || knownFolders.some(n => "f:" + n === destId) || knownFavs.some(f => "p:" + f.path === destId);
  if (!offered) {
    const name = destId.startsWith("p:") ? (destId.slice(2).split(/[\\/]/).filter(Boolean).pop() || destId)
               : destId.startsWith("f:") ? destId.slice(2) : destId;
    html += `<option value="${escapeHtml(destId)}" selected disabled>${escapeHtml(t("watch_dest_missing").replace("{name}", name))}</option>`;
  }
  return html;
}

// Populate both folder selects in the Queue tab.
function populateQueueFolderSelects() {
  const all = $("queueAllFolder");
  if (all) all.innerHTML = buildFolderSelectOptions(all.value || "");
  // Per-row selects are re-rendered by renderQueue()
}

// Convert a queue item's destId to download opts fields.
// Shared with the automated checks (renderer/destination.js). A malformed destId
// yields { destInvalid: true }; only an empty/absent id means "main folder".
function queueItemDest(item) {
  return SelektDest.queueItemDest(item);
}

// Convert a queue item to opts for api.download().
function toDownloadOpts(item) {
  const [kind, val] = (item.format || "audio:mp3").split(":");
  const isPlaylist = !!item.playlist;
  const opts = {
    url: item.url,
    type: isPlaylist ? "playlist" : (kind === "audio" ? "audio" : "video"),
    audioFormat: kind === "audio" ? val : undefined,
    bitrate: item.bitrate || DEFAULT_AUDIO_BITRATE,   // a stored item's own bitrate always wins
    quality: kind === "video" ? val : undefined,
    noConvert: val === "original" || undefined,
    force: !!item.force, // set on explicit Retry to override the duplicate skip
    // Per-item settings captured at press time; fall back to current globals
    // for items added from the Queue tab (which don't store these).
    autoTag:  item.autoTag  !== undefined ? item.autoTag  : autoTagEnabled,
    loudnorm: item.loudnorm !== undefined ? item.loudnorm : loudnormEnabled,
    lufs:     item.lufs     !== undefined ? item.lufs     : lufsValue,
    _inQueue: true,  // suppresses the blocking dup modal in main.js
    _queueId: item.id,   // echoed back in main's "fingerprint-dup" event: identifies the row even if the result arrives late
  };
  if (isPlaylist && kind === "audio") opts.audioOnly = true;
  if (isPlaylist && Array.isArray(item.playlistItems) && item.playlistItems.length) {
    opts.playlistItems = item.playlistItems;   // only the tracks kept in the picker
  }
  Object.assign(opts, queueItemDest(item));
  return opts;
}

// Current Download-tab selection → a queue item (no id; main assigns it).
function currentDestId() {
  return currentFav ? ("p:" + currentFav.path) : (currentTarget ? "f:" + currentTarget : "");
}
function buildQueueItemFromSelection(url, force = false) {
  return {
    url,
    destId: currentDestId(),
    format: $("format").value,        // "audio:mp3" | "video:1080" | ...
    bitrate: $("bitrate").value,
    autoTag: autoTagEnabled,
    loudnorm: loudnormEnabled,
    lufs: lufsValue,
    playlist: playlistOn,
    force: !!force,                   // skip the dup check (user confirmed "anyway")
    status: "pending",
    title: (lastProbe && lastProbe.title) ? lastProbe.title : "",
    error: null,
  };
}

// Render the queue table.
async function renderQueue() {
  const tbody = $("queueRows");
  if (!tbody) return;
  const q = await api.queueGet();
  tbody.innerHTML = "";
  if (!q || !q.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--faint);padding:24px 0">${t("queue_empty")}</td></tr>`;
    $("queueSummary").textContent = "";
    return;
  }
  q.forEach(item => {
    const tr = document.createElement("tr");
    tr.className = "q-row";
    tr.dataset.id = item.id;

    // Status icon
    const statusMap = { pending:"q-st-pending", running:"q-st-running", done:"q-st-done", error:"q-st-error", skipped:"q-st-skipped", flagged:"q-st-flagged", canceled:"q-st-skipped" };
    const stCls = statusMap[item.status] || "q-st-pending";
    let progressHtml = "";
    if (item.status === "running") {
      progressHtml = `<span class="q-progress" id="qprog-${item.id}"></span>`;
    } else if (item.error) {
      // Full error, wrapped (not clipped) so the real cause is always visible;
      // title= gives the same text on hover as a fallback.
      progressHtml = `<div class="q-err" title="${escapeHtml(item.error)}">${escapeHtml(item.error)}</div>`;
    } else if (item.note) {
      progressHtml = `<div class="q-note">${escapeHtml(item.note)}</div>`;
    }
    const fpHtml = item.fpDup
      ? `<div class="q-fpdup" data-fp-dup="1">⚑ ${escapeHtml(t("fp_dup_head"))}${item.fpDup.matchTitle ? " — " + escapeHtml(item.fpDup.matchTitle) : ""}</div>`
      : "";
    if (item.fpDup) tr.dataset.fpDup = "1";
    const canRetry = ["error", "skipped", "flagged", "canceled"].includes(item.status);
    // Folder/format are editable until the file is actually downloaded — so an
    // errored/skipped row can be re-pointed to a different folder or format and
    // retried. Only "done" and the currently "running" row are locked.
    const locked = item.status === "done" || item.status === "running";

    // Folder select
    const folderSel = `<select class="q-sel" data-row-id="${item.id}" data-field="destId" ${locked ? "disabled" : ""}>${destOptionsHtml(item.destId)}</select>`;

    // Format select
    const fmtOpts = [
      ["audio:mp3","MP3"],["audio:m4a","M4A"],["audio:wav","WAV"],["audio:flac","FLAC"],
      ["video:original","Video Orig"],["video:1080","1080p"],["video:720","720p"]
    ].map(([v, l]) => `<option value="${v}"${item.format === v ? " selected" : ""}>${l}</option>`).join("");
    const formatSel = `<select class="q-sel" data-row-id="${item.id}" data-field="format" ${locked ? "disabled" : ""}>${fmtOpts}</select>`;

    tr.innerHTML = `
      <td class="q-status"><span class="${stCls}"></span></td>
      <td class="q-cell"><div class="q-url" title="${escapeHtml(item.url)}">${escapeHtml(item.title || item.url)}</div>${progressHtml}${fpHtml}</td>
      <td>${folderSel}</td>
      <td>${formatSel}</td>
      <td style="white-space:nowrap">
        ${canRetry ? `<button class="sec q-retry" data-id="${item.id}" title="${t("q_retry")}">↻</button>` : ""}
        <button class="sec q-remove" data-id="${item.id}" aria-label="${escapeHtml(t("remove") + ": " + (item.title || item.url))}" title="${escapeHtml(t("remove"))}" ${queueRunning ? "disabled" : ""}>✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Retry a single skipped/errored item (force past the duplicate skip).
  tbody.querySelectorAll(".q-retry").forEach(btn => {
    btn.onclick = async () => {
      const q2 = await api.queueGet();
      const it = q2.find(i => i.id === btn.dataset.id);
      const force = !!(it && it.status === "skipped"); // override "avoid duplicates" on explicit retry
      await api.queueUpdateItem({ id: btn.dataset.id, status: "pending", error: null, note: null, force, fpDup: null });
      renderQueue();
      if (!queueRunning) runQueue();
    };
  });

  // Attach change handlers for per-row selects
  tbody.querySelectorAll("select[data-row-id]").forEach(sel => {
    sel.addEventListener("change", async () => {
      await api.queueUpdateItem({ id: sel.dataset.rowId, [sel.dataset.field]: sel.value });
    });
  });

  // Attach remove handlers
  tbody.querySelectorAll(".q-remove").forEach(btn => {
    btn.onclick = async () => {
      const q2 = await api.queueGet();
      await api.queueSet(q2.filter(i => i.id !== btn.dataset.id));
      renderQueue();
    };
  });

  // Summary
  const done    = q.filter(i => i.status === "done").length;
  const skipped = q.filter(i => i.status === "skipped" || i.status === "flagged").length;
  const errored = q.filter(i => i.status === "error").length;
  const pending = q.filter(i => i.status === "pending").length;
  if (done + skipped + errored > 0) {
    $("queueSummary").innerHTML =
      `<span class="ok-c">${done} ✓</span>  ` +
      (skipped ? `<span class="skip-c">${skipped} ⊘</span>  ` : "") +
      (errored ? `<span class="err-c">${errored} ✕</span>  ` : "") +
      (pending ? `${pending} pending` : "");
  } else {
    $("queueSummary").textContent = "";
  }

  // Run/pause button state
  const runBtn   = $("queueRunBtn");
  const pauseBtn = $("queuePauseBtn");
  if (queueRunning) {
    runBtn.style.display   = "none";
    pauseBtn.style.display = "";
    pauseBtn.textContent   = queuePaused ? t("queue_resume") : t("queue_pause");
  } else {
    runBtn.style.display   = "";
    pauseBtn.style.display = "none";
    runBtn.disabled = !q.some(i => i.status === "pending");
  }

  // "Retry failed" button — visible whenever there are skipped/errored/flagged
  // items, even while the queue runs (retries stack and get picked up in order).
  const retryBtn = $("queueRetryBtn");
  if (retryBtn) {
    retryBtn.style.display = q.some(i => ["error", "skipped", "flagged"].includes(i.status)) ? "" : "none";
  }
}

// Update progress display for an active queue row.
function updateQueueRowProgress(id, info) {
  const el = document.getElementById(`qprog-${id}`);
  if (!el) return;
  if (info.phase === "normalizing") { el.textContent = t("normalizing_phase"); return; }
  let s = "";
  if (info.itemTotal > 0) s += (info.itemPos || 1) + "/" + info.itemTotal + " · ";
  if (info.pct != null) s += Math.round(info.pct) + "%";
  el.textContent = s;
}

// Sequential queue runner. Re-queries each iteration so links you add WHILE it's
// running (by pressing Download again) get picked up in order.
async function runQueue() {
  if (queueRunning) return;
  queueRunning = true; queuePaused = false;
  renderQueue();

  while (queueRunning) {
    if (queuePaused) {
      await new Promise(r => setTimeout(r, 300));
      continue;
    }
    const q = await api.queueGet();
    const item = q.find(i => i.status === "pending");
    if (!item) break;  // nothing left — but new presses can re-trigger runQueue()

    // Show the prominent card for this item — start in the indeterminate state
    // (sliding stripe) so there's visible motion before the first % arrives.
    $("dlActiveTitle").textContent = item.title || item.url;
    $("dlActiveTrack").textContent = "";   // reset per-track counter for the new item
    $("dlActiveBar").classList.add("indet");
    $("dlActiveFill").style.width = ""; $("dlActiveFill").style.marginLeft = "";
    $("dlActivePct").textContent = "";
    $("dlActiveSpeed").textContent = "";
    $("dlActiveEta").textContent = "";
    $("dlActivePhase").textContent = "";
    $("dlActive").style.display = "block";
    setCancelBusy(false);   // re-arm Cancel for this item

    queueActiveId = item.id;
    await api.queueUpdateItem({ id: item.id, status: "running" });
    updateActiveCount();   // "N waiting" after this one
    renderQueue();

    const opts = toDownloadOpts(item);
    let r;
    if (opts.destInvalid) {
      r = { ok: false, error: t("dest_bad") };   // malformed destId: per-item error, nothing sent to main
    } else {
      try { r = await api.download(opts); }
      catch (e) { r = { ok: false, error: String(e) }; }
    }

    let status = "error";
    let title = item.title;
    let error = null;
    let note = null;
    const normWarn = r.ok ? normWarnText(r.normalizeWarning) : "";
    if (r.ok) {
      status = "done";   // the file IS downloaded; a normalization problem is a warning on a done row, not an error
      if (r.files && r.files[0]) title = lastSeg(r.files[0]);
      if (normWarn) note = normWarn;
    } else if (r.canceled) {
      status = "canceled";
      note = canceledNote(r) || t("q_canceled");   // retryable, not a failure
    } else if (r.duplicate || r.skipped) {
      status = "skipped";
      note = t("q_skipped_dup");   // explain WHY (so it's not mistaken for an error)
    } else {
      error = r.needsCookies ? t("cookies_hint") : (r.error || t("dl_failed"));
    }

    await api.queueUpdateItem({ id: item.id, status, title, error, note });

    // If this item is the one the picker dialog is tracking, finalize its view.
    if (plProgress && plProgress.itemId === item.id) finishPlaylistProgress(status);

    // Mirror the result onto the Download tab so failures are visible without
    // opening the Queue tab. Errors persist (not auto-cleared) so the user can
    // read them; a success briefly confirms.
    const msg = $("msg");
    if (msg) {
      if (status === "error") {
        msg.className = "err";
        msg.textContent = t("err_pre") + " " + (title || item.url) + " — " + error;
      } else if (status === "done" && normWarn) {
        msg.className = "warn";
        msg.textContent = normWarn + " " + t("norm_warn_in").replace("{folder}", lastSeg(r.folder) || t("main_folder_lc"));
      } else if (status === "done") {
        msg.className = "ok";
        msg.textContent = t("done_msg").replace("{n}", (r.count != null ? r.count : 1))
          .replace("{folder}", lastSeg(r.folder) || t("main_folder_lc"));
      } else if (status === "canceled") {
        msg.className = "";
        msg.textContent = canceledNote(r) || t("canceled_msg");
      }
    }

    queueActiveId = null;
    renderQueue();

    // "Stop all": also cancel everything still waiting, then leave the loop.
    // Items become "canceled" (not deleted) so ↻ can bring any of them back.
    if (stopAllRequested) {
      stopAllRequested = false;
      const rest = await api.queueGet();
      let n = 0;
      for (const it of rest) {
        if (it.status === "pending") {
          await api.queueUpdateItem({ id: it.id, status: "canceled", error: null, note: t("q_canceled") });
          n++;
        }
      }
      if (msg) { msg.className = ""; msg.textContent = t("canceled_all_msg").replace("{n}", n); }
      renderQueue();
      break;
    }
  }

  queueRunning = false; queueActiveId = null; stopAllRequested = false;
  hideBar();
  setCancelBusy(false);
  if ($("dlActive")) $("dlActive").style.display = "none";  // hide card when queue is empty
  if ($("dlActiveBar")) $("dlActiveBar").classList.remove("indet");
  renderQueue();
}

// ---------------------------------------------------------------------------
// Cancel / Stop all — live on the "Downloading" card, so they only exist while
// something is actually running and never crowd the Download button.
// ---------------------------------------------------------------------------
function setCancelBusy(busy) {
  const c = $("dlCancelBtn"), s = $("dlStopAllBtn");
  if (c) { c.disabled = !!busy; c.textContent = busy ? t("canceling") : t("cancel_dl"); }
  if (s) s.disabled = !!busy;
}

if ($("dlCancelBtn")) $("dlCancelBtn").onclick = async () => {
  if (!queueRunning) return;
  setCancelBusy(true);
  try { await api.cancelDownload(); } catch (_) { setCancelBusy(false); }
};

if ($("dlStopAllBtn")) $("dlStopAllBtn").onclick = async () => {
  if (!queueRunning) return;
  stopAllRequested = true;
  setCancelBusy(true);
  try { await api.cancelDownload(); } catch (_) { stopAllRequested = false; setCancelBusy(false); }
};

// "N waiting" badge on the active-download card (pending after the current one).
async function updateActiveCount() {
  if (!queueRunning) {
    if ($("dlActiveCount")) $("dlActiveCount").textContent = "";
    if ($("dlStopAllBtn")) $("dlStopAllBtn").style.display = "none";
    return;
  }
  const q = await api.queueGet();
  const waiting = q.filter(i => i.status === "pending").length;
  if ($("dlActiveCount"))
    $("dlActiveCount").textContent = waiting > 0 ? t("queue_waiting").replace("{n}", waiting) : "";
  // "Stop all" only makes sense when there's more than the current item.
  if ($("dlStopAllBtn")) $("dlStopAllBtn").style.display = waiting > 0 ? "" : "none";
}

// ---- Queue UI event handlers ----
$("queueRunBtn").onclick = () => { queuePaused = false; runQueue(); };

$("queuePauseBtn").onclick = () => {
  if (queueRunning) {
    queuePaused = !queuePaused;
    $("queuePauseBtn").textContent = queuePaused ? t("queue_resume") : t("queue_pause");
  }
};

$("queueClearBtn").onclick = async () => {
  if (queueRunning) { queueRunning = false; queueActiveId = null; }
  await api.queueClear();
  renderQueue();
};

// Retry every skipped/errored/flagged item at once (skipped → forced past dup).
$("queueRetryBtn").onclick = async () => {
  const q = await api.queueGet();
  for (const it of q) {
    if (["error", "skipped", "flagged"].includes(it.status)) {
      await api.queueUpdateItem({
        id: it.id, status: "pending", error: null, note: null, fpDup: null,
        force: it.status === "skipped",
      });
    }
  }
  renderQueue();
  if (!queueRunning) runQueue();
};

$("queueAddBtn").onclick = async () => {
  const txt = $("queueInput").value;
  const urls = parseLinks(txt);
  if (!urls.length) return;
  const defaultFormat = $("format").value; // inherit current UI selection
  const defaultBitrate = $("bitrate").value;
  // Destination = the "Folder →" dropdown above the table. This links each
  // batch of pasted links to the folder/playlist selected right now, so you can
  // add one set to "Afro Dancehall", switch the dropdown, and add another set
  // to a different folder. ("" = main folder.)
  const defaultDestId = $("queueAllFolder").value || "";
  const items = urls.map(url => ({
    id: crypto.randomUUID(),
    url,
    destId: defaultDestId,
    format: defaultFormat,
    bitrate: defaultBitrate,
    status: "pending",
    title: "",
    error: null,
  }));
  await api.queueAdd(items);
  $("queueInput").value = "";
  renderQueue();
};

$("queueApplyAll").onclick = async () => {
  const destId = $("queueAllFolder").value;
  const q = await api.queueGet();
  for (const item of q.filter(i => i.status === "pending")) {
    await api.queueUpdateItem({ id: item.id, destId });
  }
  renderQueue();
};

// Resume banner buttons
$("queueResumeYes").onclick = () => {
  $("queueResumeBanner").classList.remove("show");
  // Switch to queue tab and run
  document.querySelector(".tab[data-tab='queue']").click();
  runQueue();
};
$("queueResumeDismiss").onclick = () => {
  $("queueResumeBanner").classList.remove("show");
};

// Backend events
api.onQueueChanged(() => renderQueue());
api.onQueueRun(() => runQueue());

// ===========================================================================
// FEATURE 2 — WATCH-FOLDER SETTINGS
// ===========================================================================
let watchSettings = {};

async function refreshWatchSettings() {
  watchSettings = (await api.watchGet()) || {};
  const enabled = !!watchSettings.enabled;
  const path    = watchSettings.inbox_path || "";
  // Stored as `destid` (same field name main.js reads and writes). "" = main folder.
  const destId = watchSettings.destid;   // as stored; destOptionsHtml shows a damaged value as unavailable
  const autorun = !!watchSettings.autorun;

  const toggle = $("watchToggle");
  toggle.classList.toggle("active", enabled);
  toggle.setAttribute("aria-pressed", String(enabled));

  $("watchConfig").style.display = enabled ? "" : "none";
  $("watchPath").textContent = path || "—";
  $("watchPath").title = path;

  // Populate dest folder select
  const sel = $("watchDestFolder");
  if (sel) sel.innerHTML = destOptionsHtml(destId);   // the right option carries `selected`; no separate .value assignment

  const autoBtn = $("watchAutorunToggle");
  autoBtn.classList.toggle("active", autorun);
  autoBtn.setAttribute("aria-pressed", String(autorun));

  $("watchStatus").textContent = enabled ? t("watch_watching") : t("watch_stopped");
}

$("watchToggle").onclick = async () => {
  const nowEnabled = !watchSettings.enabled;
  await api.watchSet({ enabled: nowEnabled });
  if (nowEnabled) { await api.watchStart(); } else { await api.watchStop(); }
  await refreshWatchSettings();
};

$("pickWatchPath").onclick = async () => {
  const p = await api.pickFolder(); // reuse folder picker — user picks the dir then we append /inbox.txt
  if (!p) return;
  const inboxPath = p + "/inbox.txt";
  await api.watchSet({ inbox_path: inboxPath });
  watchSettings.inbox_path = inboxPath;
  $("watchPath").textContent = inboxPath;
  $("watchPath").title = inboxPath;
  if (watchSettings.enabled) { await api.watchStop(); await api.watchStart(); }
};

$("watchDestFolder").addEventListener("change", async () => {
  const value = $("watchDestFolder").value;
  await api.watchSet({ destid: value });   // `destid`: the field main.js stores (config watch_destid) and watch-get returns
  watchSettings.destid = value;
});

$("watchAutorunToggle").onclick = async () => {
  const nowAuto = !watchSettings.autorun;
  await api.watchSet({ autorun: nowAuto });
  watchSettings.autorun = nowAuto;
  $("watchAutorunToggle").classList.toggle("active", nowAuto);
  $("watchAutorunToggle").setAttribute("aria-pressed", String(nowAuto));
};

// ===========================================================================
// FEATURE 3 — FINGERPRINT SETTINGS
// ===========================================================================
let fpSettings = {};
// Pending fp-dup data (for the delete button)
let fpDupPending = null;

async function refreshFingerprintSettings() {
  fpSettings = (await api.fingerprintGetSettings()) || {};
  const enabled   = !!fpSettings.enabled;
  const available = !!fpSettings.fpcalcAvailable;
  const count     = fpSettings.count || 0;
  const threshold = fpSettings.threshold || 0.9;

  const toggle = $("fpToggle");
  toggle.classList.toggle("active", enabled);
  toggle.setAttribute("aria-pressed", String(enabled));
  $("fpConfig").style.display = enabled ? "" : "none";

  $("fpStatus").textContent = available
    ? t("fp_status_ok").replace("{n}", count)
    : t("fp_status_missing");
  $("fpStatus").style.color = available ? "var(--ok)" : "#ff6b6b";

  if ($("fpThreshold")) $("fpThreshold").value = String(threshold);
}

$("fpToggle").onclick = async () => {
  const nowEnabled = !fpSettings.enabled;
  await api.fingerprintSetEnabled(nowEnabled);
  fpSettings.enabled = nowEnabled;
  $("fpToggle").classList.toggle("active", nowEnabled);
  $("fpToggle").setAttribute("aria-pressed", String(nowEnabled));
  $("fpConfig").style.display = nowEnabled ? "" : "none";
};

$("fpThreshold").addEventListener("change", async () => {
  const val = parseFloat($("fpThreshold").value) || 0.9;
  await api.fingerprintSetThreshold(val);
  fpSettings.threshold = val;
});

$("fpRebuild").onclick = async () => {
  $("fpRebuild").disabled = true;
  $("fpRebuild").textContent = t("fp_rebuilding");
  await api.fingerprintRebuild();
  await refreshFingerprintSettings();
  $("fpRebuild").disabled = false;
  $("fpRebuild").textContent = t("fp_rebuild");
};

// Fingerprint dup event (arrives async, after download completes)
// fpDupPending = the one warning currently on screen ({..., offerId, busy}). Main keeps at most one
// live offer (the newest single-mode warning); a newer warning replaces this one, and closing the
// warning (Keep both) revokes its offer in main. A queue-mode event shows no warning and must not
// touch the one on screen.
api.onFingerprintDup((d) => {
  if (d.inQueue) {
    // Queue mode: mark the ORIGINATING row, found by the queue id main echoes back from the download
    // request (never by "the item running now": the result can arrive after the queue moved on or the
    // item finished). Only a separate flag is written; status/title/error/note are left alone, so a
    // completed download stays completed and a later status write by the runner cannot erase the flag.
    const rowId = d.queueId;
    if (typeof rowId !== "string" || !rowId) return;          // no identity -> never guess a row
    (async () => {
      try {
        await api.queueUpdateItem({ id: rowId, fpDup: { matchTitle: d.matchTitle || lastSeg(d.matchFile) || "" } });
        renderQueue();
      } catch (_) {}
    })();
    return;
  }
  // Single mode: show the warning in the download tab (replacing any earlier one)
  fpDupPending = d;
  d.busy = false;
  $("fpDupDelete").disabled = false;
  $("fpDupTitle").textContent = d.newTitle || lastSeg(d.newFile) || "";
  $("fpDupMatch").textContent = d.matchTitle || lastSeg(d.matchFile) || "";
  $("fpDupWarning").style.display = "block";
});

// Close the warning and revoke its permission in main. Does not cancel a trash already running.
$("fpDupDismiss").onclick = () => {
  const w = fpDupPending;
  $("fpDupWarning").style.display = "none";
  fpDupPending = null;
  if (w && w.offerId) { try { Promise.resolve(api.fingerprintDismiss(w.offerId)).catch(() => {}); } catch (_) {} }
};

$("fpDupOpen").onclick = () => {
  if (fpDupPending && fpDupPending.matchFile) runOpenAction(() => api.reveal(fpDupPending.matchFile), "dock", "file");
};

$("fpDupDelete").onclick = async () => {
  const w = fpDupPending;                       // this click belongs to THIS warning, whatever happens meanwhile
  if (!w || !w.newFile || !w.offerId || w.busy) return;
  w.busy = true; $("fpDupDelete").disabled = true;
  const ok = await runOpenAction(() => api.deleteFile(w.newFile, w.offerId), "dock", "trash");
  w.busy = false;
  // Warning identity is re-checked in the SAME synchronous step as every change to the warning UI, after
  // each await: a newer warning (or a dismissal) can arrive while the trash or the history refresh is
  // pending, and an old result must never close, clear, re-enable or otherwise touch a newer warning.
  if (fpDupPending === w) $("fpDupDelete").disabled = false;
  if (!ok) return;                              // not deleted: a still-visible warning can retry, a closed one cannot
  await refreshHistory();
  if (fpDupPending === w) {                     // still the warning on screen (not replaced / dismissed during the refresh)
    $("fpDupWarning").style.display = "none";
    fpDupPending = null;
  } else {
    flashMsg(t("h1_trash_after_dismiss"), "", 8000);   // the OS operation was not cancelled by closing the warning
  }
};

// ===========================================================================
// INIT
// ===========================================================================
(async () => {
  await refreshSettings();
  applyI18n();
  await refreshFolders();
  await refreshFavorites();
  await refreshHistory();
  populateQueueFolderSelects();

  // Check for pending queue items on launch — offer resume
  const q = await api.queueGet();
  const hasPending = q && q.some(i => i.status === "pending" || i.status === "running");
  if (hasPending) {
    $("queueResumeBanner").classList.add("show");
  }
})();
