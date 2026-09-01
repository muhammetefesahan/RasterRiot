# Mimari

RasterRiot derleme adımı ve çalışma zamanı bağımlılığı olmayan statik bir web uygulamasıdır.

## Veri akışı

```text
Kullanıcı dosyaları
      │
      ▼
Tür / adet / bellek doğrulaması
      │
      ▼
createImageBitmap veya Image ile yerel çözme
      │
      ▼
Canvas: geometri → renk → filigran → yeniden kodlama
      │
      ├──► Canlı Blob önizlemesi / tekli indirme
      │
      └──► Sıralı kuyruk → Uint8Array → yerel ZIP → indirme
```

Hiçbir aşamada kaynak veya çıktı görseli ağ isteğine dönüşmez.

## Modüller

- `src/core.js`: saf ayar normalizasyonu, reçeteler, geometri, sınırlar ve dosya adı güvenliği.
- `src/zip.js`: CRC32 ve klasik ZIP kayıtlarını yazan bağımsız paketleyici.
- `src/app.js`: dosya yaşam döngüsü, canvas hattı, erişilebilir arayüz ve toplu işleme orkestrasyonu.
- `sw.js`: yalnızca aynı kökendeki statik uygulama kabuğunu önbellekler.

## Bellek disiplini

Dosyalar sıralı işlenir. Her çözülmüş bitmap işlem sonunda kapatılır; geçici canvas küçültülür; değiştirilen nesne URL'leri iptal edilir. Kaynak dosyaların toplamı 500 MB, çıktı tuvali 16 MP ile sınırlıdır. İptal isteği mevcut görsel bittikten sonra uygulanır ve daha önce tamamlanan dosyalar ZIP olarak korunur.

## Güvenlik

- CSP: `connect-src 'none'`, `object-src 'none'`, `form-action 'none'`, `frame-ancestors 'none'`.
- Dosya adları yol parçalarından ve tehlikeli karakterlerden arındırılır.
- Uzak script, font, stil, analitik veya CDN kullanılmaz.
- Canvas yeniden kodlaması kaynak metadata bloklarını taşımaz.

## Erişilebilirlik

Dosya bırakma alanı gerçek bir düğmedir ve klavyeyle çalışır. Kuyruk `listbox/option` semantiği kullanır; ok, Home/End ve Delete/Backspace tuşları desteklenir. Karşılaştırma kontrolü native `range` girdisidir; hareketli kontrol en az 44×44 pikseldir. Durum değişiklikleri canlı bölge üzerinden duyurulur.
