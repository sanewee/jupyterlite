# 데이터 과학 프로젝트 노트북 (JupyterLite)

브라우저 안에서 돌아가는 파이썬 노트북입니다. 서버가 없어서 GitHub Pages에 올리기만 하면 됩니다.

## 올리는 순서

1. GitHub에서 새 저장소를 만든다. (이름 예: `ds-notebook`)
2. 이 폴더의 파일을 전부 그 저장소에 올린다.
   - 웹에서 할 경우: `Add file` → `Upload files` → 폴더째 끌어다 놓기
   - `.github` 폴더가 같이 올라갔는지 꼭 확인 (숨김 폴더라 빠지기 쉬움)
3. 저장소 → `Settings` → `Pages` → **Source를 `GitHub Actions`로** 바꾼다.
4. `Actions` 탭에서 빌드가 끝나기를 기다린다. (2~3분)
5. 초록 체크가 뜨면 주소가 나온다.
   `https://sanewee.github.io/jupyterlite/`

## 웹앱에 연결하기

`ai-project-coach-v2.html` 안의 이 줄을 위에서 받은 주소로 바꾼다.

```js
const NB_BASE = "https://jupyterlite.github.io/demo/";
```
↓
```js
const NB_BASE = "https://sanewee.github.io/jupyterlite/";
```

iframe의 `src`도 같은 주소로 바꾼다.

## 폴더 설명

| 경로 | 설명 |
|---|---|
| `requirements.txt` | 빌드에 쓰는 패키지 버전 |
| `content/` | 학생에게 기본으로 보일 노트북. 여기에 파일을 넣으면 사이트에 같이 실린다 |
| `.github/workflows/deploy.yml` | 올릴 때마다 자동으로 빌드·배포 |
| `jupyter-lite.json` | 앱 이름 등 설정 |

## 알아둘 것

- 학생이 만든 파일은 **그 학생 브라우저에만** 저장된다. 서버로 올라가지 않는다.
  → 브라우저 기록을 지우거나 다른 기기에서 열면 사라지므로, 완성한 ipynb는 반드시 내려받아 제출하게 할 것.
- `!pip install`은 안 되고 `%pip install` 을 쓴다.
- 텐서플로우·케라스는 돌아가지 않는다. 딥러닝 단계는 코랩을 따로 쓸 것.
- `content/` 에 넣는 자료의 저작권은 직접 확인할 것. (교과서 원본 등은 넣지 말 것)

## 학교 네트워크가 외부 CDN을 막는 경우

시작 노트북의 폰트 셀은 jsDelivr에서 나눔고딕을 받아옵니다. 학교에서 막혀 있다면
폰트 파일을 저장소에 같이 넣어 우리 사이트에서 받도록 바꾸면 됩니다.

1. [나눔고딕 TTF](https://github.com/google/fonts/blob/main/ofl/nanumgothic/NanumGothic-Regular.ttf)를 받아 `content/NanumGothic-Regular.ttf` 로 저장 (SIL OFL 라이선스, 재배포 가능)
2. 시작 노트북의 폰트 주소를 아래처럼 바꾼다

```python
FONT_URL = "./files/NanumGothic-Regular.ttf"
```
