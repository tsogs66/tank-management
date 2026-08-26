# Bundled runtime

Empty in the repository. The release build fills it with a Python interpreter,
the packages in `requirements.txt` and Tesseract OCR, so the installed program
can read PDF and Excel calibration books on a computer that has none of them
and no internet connection.

Populate it with `npm run stage:runtime` on Windows. Everything except the four
importer features works whether or not it is present.
