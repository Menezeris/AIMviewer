# Fork patch AIM D-135 (#207)

Base: Menezeris/ifc-lite `main` @ 625cabd74d067e89e8d8afbb003c4d35f95fe519.
sha256 `aim-d135-archive-autoload.patch`: ec4d0a11eded096047c00ab1f7379305c1c3920cc0ac958a8b8c84ea1ad52af6

```bash
git checkout -b claude/aim-d135-archiv 625cabd74
git am aim-d135-archive-autoload.patch
```

Telo PR: `PR_BODY.md`. Pri otvorení PR štítok `revert-oracle-exempt`. Host: Menezeris/AIMviewer (PR k #207).
Poradie: fork sa zlúči a nasadí pred AIMviewerom (inak host s `NEXT_PUBLIC_IFC_ARCHIVE=0`).
