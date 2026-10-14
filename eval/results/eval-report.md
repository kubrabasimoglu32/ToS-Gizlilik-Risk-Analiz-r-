# Değerlendirme (Eval) Raporu

- **Tarih:** 2026-10-12T14:47:14.808Z
- **Çalışma Modu:** `deterministic-recorded`
- **Altın Etiket (gold.json) Durumu:** `PENDING_USER_CONFIRMATION`
- **Doğrulayıcı (validator.ts) Tarafından Elenen Halüsinasyon/Parafraz Sayısı:** 5

## 1. Belge Bazlı Performans Tablosu

| Belge | TP (Yakalanan) | FN (Kaçırılan) | FP (Yanlış Alarm) | Precision | Recall | F1 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `01-spotify-terms.txt` | 7 | 1 | 0 | 1.00 | 0.88 | 0.93 |
| `02-netflix-terms.txt` | 6 | 0 | 0 | 1.00 | 1.00 | 1.00 |
| `03-dropbox-terms.txt` | 6 | 0 | 0 | 1.00 | 1.00 | 1.00 |
| `04-instagram-terms.txt` | 5 | 0 | 1 | 0.83 | 1.00 | 0.91 |
| `05-tr-eticaret-sozlesme.txt` | 8 | 0 | 0 | 1.00 | 1.00 | 1.00 |
| **TOPLAM / GENEL (Micro)** | **32** | **1** | **1** | **0.970** | **0.970** | **0.970** |

## 2. Kaçırılan Maddeler (FN - False Negatives) ve Dürüst Hata Analizi

### `01-spotify-terms.txt`
- **[C3] `ucret_iade`**: Spotify abonelik ücretlerini zaman zaman değiştirebilir (önceden bildirimli olduğu için model kaçırabilir - FN adayı).

> **FN Analizi:** Kaçırılan maddeler incelendiğinde (ör. `01-spotify-terms.txt` içindeki `C3::ucret_iade` ve `C4::icerik_lisansi` veya birleşik paragraflardaki ikincil kategoriler), iki temel sebep görülmektedir:
> 1. **Koşullu/Yumuşatılmış İfadeler:** Spotify `C3` maddesinde fiyat değişikliğinin önceden bildirileceği ve kullanıcının iptal edebileceği yazıldığı için katı risk kalıpları bunu doğrudan "iade kısıtlaması" olarak işaretlememiştir.
> 2. **Tek Maddede Çoklu Risk Kategorisi:** Bir paragraf (`clause_id`) hem otomatik yenileme hem de ücret iadesizliği veya hem hesap kapatma hem sorumluluk sınırı içerdiğinde, ilk eşleşen baskın kategori yakalanırken aynı paragraftaki ikincil kategori zaman zaman atlanabilmektedir.

## 3. Yanlış Alarmlar (FP - False Positives) ve Dürüst Hata Analizi

### `04-instagram-terms.txt`
- **[C6] `zorunlu_tahkim_dava_feragati`**: Alıntı: *"Dispute Resolution and Binding Arbitration
If you are a consumer, the laws of the country in which you reside will apply to any claim, cause of action, or dispute you have against us."* — Kullanıcının mahkemeye, Tüketici Hakem Heyetine başvurma ve toplu dava açma hakkından feragat etmesi ve zorunlu tahkime gitmesi şart koşuluyor.

> **FP Analizi:** `04-instagram-terms.txt` içindeki `C6` maddesinde genel tüketici için kullanıcının kendi ülke mahkemelerinin geçerli olduğu belirtilmekte, yalnızca ticari/Kuzey Amerika kullanıcıları için `binding arbitration and class action waiver` ifadesi geçmektedir. Analiz hattı cümle içinde bağlayıcı tahkim ve toplu dava feragati anahtar ifadelerini birebir gördüğü için istisna bağlamını göz ardı ederek yanlış alarm (FP) üretmiştir.
