# Fork patch AIM D-135 (#207)

Base: Menezeris/ifc-lite `main` @ 625cabd74d067e89e8d8afbb003c4d35f95fe519.
sha256 `aim-d135-archive-autoload.patch`: 08c8d204c693a69ba8f9c59eced18652bdda5217d628b297cf7be55dfbfafbc1

```bash
git checkout -b claude/aim-d135-archiv 625cabd74
git am aim-d135-archive-autoload.patch
```

Telo PR: `PR_BODY.md`. Pri otvorení PR štítok `revert-oracle-exempt`. Host: Menezeris/AIMviewer (PR k #207).
Poradie: fork sa zlúči a nasadí pred AIMviewerom (inak host s `NEXT_PUBLIC_IFC_ARCHIVE=0`).
