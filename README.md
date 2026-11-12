# Excel Ligero

Hoja de cálculo ligera que corre en el navegador. Sin instalación, sin cuenta y sin subir tus datos a ningún servidor: el libro se guarda en tu propio navegador.

**Úsala aquí:** <https://c28309208.github.io/excel-ligero/>

## Qué incluye

- Rejilla de 100 × 26 con edición tipo Excel (Enter, Tab, flechas, F2, copiar/pegar).
- Fórmulas con referencias (`A1`), rangos (`A1:B10`), referencias entre hojas (`Hoja2!A1`) y detección de ciclos.
- Más de 50 funciones: SUMA, PROMEDIO, MIN, MAX, CONTAR, CONTARA, SI, SI.ERROR, Y, O, NO, REDONDEAR, ENTERO, RESIDUO, POTENCIA, RAIZ, CONCATENAR, LARGO, IZQUIERDA, DERECHA, EXTRAE, MAYUSC, MINUSC, ESPACIOS, ENCONTRAR, SUSTITUIR, VALOR, TEXTO, HOY, AHORA, AÑO, MES, DIA, FECHA, BUSCARV, INDICE, COINCIDIR, CONTAR.SI, SUMAR.SI, PROMEDIO.SI, MEDIANA, MAYOR, MENOR, SUMAPRODUCTO (y sus equivalentes en inglés).
- Varias hojas, formato (negrita, cursiva, subrayado, color, relleno, alineación, formatos de número y fecha).
- **Abrir** `.xlsx`, `.xls`, `.xlsm`, `.csv`, `.json` y **guardar** como `.xlsx` o `.csv` (las fórmulas se conservan al guardar; los estilos de Excel no se importan).
- **Conectar datos**: trae un CSV o JSON desde una URL y actualízalo cuando quieras (el sitio debe permitir CORS).
- Guardado automático en `localStorage`, deshacer/rehacer y cálculo de suma/promedio de la selección.

## Límites

- No ejecuta macros VBA (.xlsm) ni reproduce el motor completo de Excel: fórmulas fuera de la lista devuelven error.
- Los estilos y formatos condicionales de un `.xlsx` importado no se conservan.
- Las conexiones dependen de CORS del servidor de origen.

## Desarrollo

Todo es estático: `index.html`, `css/app.css`, `js/engine.js` (motor de fórmulas), `js/app.js` (interfaz) y `js/xlsx.full.min.js` (SheetJS).

    python -m http.server 8123
    # abre http://127.0.0.1:8123/

Pruebas del motor: `node tests/engine.test.js`.
