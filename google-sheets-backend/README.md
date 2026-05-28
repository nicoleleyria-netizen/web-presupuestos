# Backend Google Sheets

Este backend usa Google Apps Script como puente entre la web estática y una hoja de Google Sheets.

## Qué guarda

Cada presupuesto se guarda como una fila con estas columnas:
- `id`
- `source`
- `createdAt`
- `fechaPresupuesto`
- `comitente`
- `trabajo`
- `ubicacion`
- `moneda`
- `total`
- `approved`

## Cómo configurarlo

1. Creá un proyecto nuevo en Google Apps Script.
2. Copiá el contenido de [Code.gs](Code.gs) dentro del proyecto.
3. Reemplazá `PASTE_SPREADSHEET_ID_HERE` por el ID de tu Google Sheet.
4. Creá o elegí una hoja llamada `Presupuestos`.
5. Desplegá el script como Web App.
6. Copiá la URL `/exec` y pegala en la web.

## Cómo conectar la web

En [app.js](../app.js) definí la URL del backend antes de cargar el script:

```html
<script>
  window.PRESUPUESTOS_BACKEND_URL = "https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec";
</script>
```

Si no está definida, la web sigue usando `localStorage` como respaldo local.

## Importante

La conexión usa JSONP por `GET` para evitar el bloqueo CORS de Apps Script desde una web estática.
