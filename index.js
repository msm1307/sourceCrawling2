const prompts = require("prompts");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

let errArray = [];
let success = 0;

(async function startCrawling() {
  const questions = await prompts([
    {
      type: "text",
      name: "fordername",
      message: `폴더명을 입력해 주세요.`,
    },
    {
      type: "text",
      name: "url",
      message: `홈페이지 주소를 입력해주세요.`,
    },
    {
      type: "toggle",
      name: "value",
      message: "저희 회사에서 만든 홈페이지 입니까?",
      initial: true,
      active: "yes",
      inactive: "no",
    },
  ]);

  const COMPANY = await questions.value;
  const PROJECT_FOLDER_NAME = await questions.fordername;
  const URL = await questions.url; // index.do주소

  let urlArray = [];
  const mainHostUrl = await axios.get(URL).then((res) => {
    return `${res.request.agent.protocol}//${res.request.host}`;
  });

  await createMainPage(URL, COMPANY, PROJECT_FOLDER_NAME);
  await createScriptFile(URL, PROJECT_FOLDER_NAME, mainHostUrl);
  await createCssFile(URL, PROJECT_FOLDER_NAME, mainHostUrl);
  await createImgFile(URL, PROJECT_FOLDER_NAME, mainHostUrl);
  console.log(`총 ${success}개의 파일을 생성 완료했습니다.`);
  console.log(`총 ${errArray.length}개의 파일을 생성 실패했습니다.`);
  if (errArray.length) {
    console.log(`실패 URL \n--------------------------------------------------------------------------`);
    errArray.forEach((value) => {
      console.log(value);
    });
    console.log("--------------------------------------------------------------------------");
  }
})();

async function createMainPage(url, COMPANY, PROJECT_FOLDER_NAME) {
  let mainPagePath = await axios.get(url).then((res) => {
    return res.request.path; // 현재 path
  });
  if (COMPANY) {
    mainPagePath = `${PROJECT_FOLDER_NAME}/site${mainPagePath.slice(0, mainPagePath.lastIndexOf("/") + 1)}`;
  } else {
    mainPagePath = `${PROJECT_FOLDER_NAME}${mainPagePath.slice(0, mainPagePath.lastIndexOf("/") + 1)}`;
  }

  await download(url, mainPagePath, "index.html");
}
async function createScriptFile(url, PROJECT_FOLDER_NAME, mainHostUrl) {
  let scriptURLs = [];
  await axios.get(url).then((res) => {
    const $ = cheerio.load(res.data);
    $("script").each((index, item) => {
      if (item.attribs.src && item.attribs.src[0] === "/") {
        scriptURLs.push(mainHostUrl + item.attribs.src);
      }
    });
  });
  await filteringDownload(PROJECT_FOLDER_NAME, mainHostUrl, scriptURLs);
}

function extractFileNameExtension(url) {
  // 파일명.확장자 추출
  return url.split("\\").pop().split("/").pop();
}

async function createImgFile(url, PROJECT_FOLDER_NAME, mainHostUrl) {
  const imgURLs = [];

  await axios.get(url).then((res) => {
    const $ = cheerio.load(res.data);
    $("img").each((index, item) => {
      if (item.attribs.src !== "") {
        imgURLs.push(mainHostUrl + item.attribs.src);
      }
    });
  });

  await filteringDownload(PROJECT_FOLDER_NAME, mainHostUrl, imgURLs);
}

async function createCssFile(url, PROJECT_FOLDER_NAME, mainHostUrl) {
  let mainPageCssURLs = [];
  await axios.get(url).then((res) => {
    const $ = cheerio.load(res.data);
    $("link").each((index, item) => {
      if (item.attribs.rel === "stylesheet") {
        mainPageCssURLs.push(mainHostUrl + item.attribs.href);
      }
    });
  });
  const downloadUrl = await scrapeUrlData(mainPageCssURLs, mainHostUrl);
  await filteringDownload(PROJECT_FOLDER_NAME, mainHostUrl, downloadUrl);
}

async function scrapeUrlData(urls, mainHostUrl) {
  const moveUrls = await scrapeImportData(urls, mainHostUrl);
  let downloadUrl = [...moveUrls];
  for await (const url of moveUrls) {
    await axios({
      url,
      method: "GET",
    }).then((res) => {
      let contents = res.data;
      const nowUrlPath = res.config.url;
      if (contents.includes("url")) {
        contents = contents.matchAll(/url\(['"]?(.*?)['"]?\)/g);
        Array.from(contents, (x) => downloadUrl.push(pathFiltering(x[1], mainHostUrl, nowUrlPath)));
      }
    });
  }
  downloadUrl = [...new Set(downloadUrl)];
  return downloadUrl;
}

async function scrapeImportData(urls, mainHostUrl) {
  let moveUrl = [...urls];
  for await (const url of urls) {
    await axios({
      url,
      method: "GET",
    }).then((res) => {
      let contents = res.data;
      const nowUrlPath = res.config.url;
      if (contents.includes("@import url")) {
        contents = contents.matchAll(/@import url\(['"]?(.*?)['"]?\)/g);
        Array.from(contents, (x) => moveUrl.push(pathFiltering(x[1], mainHostUrl, nowUrlPath)));
      }
    });
  }
  return moveUrl;
}

async function filteringDownload(PROJECT_FOLDER_NAME, mainHostUrl, urls) {
  //url에서 폴더 경로만 추출
  for (let url of urls) {
    console.log(url);
    if (!url.includes(mainHostUrl) || url.includes("DATA/") || url.includes("data:image")) {
      continue;
    }
    if (url.includes("?")) {
      url = url.slice(0, url.lastIndexOf("?"));
    }
    let folderPath = url.replace(mainHostUrl, "");
    folderPath = PROJECT_FOLDER_NAME + folderPath.slice(0, folderPath.lastIndexOf("/") + 1); // 폴더경로/ 까지 잘라줌
    let fileName = url.slice(url.lastIndexOf("/") + 1); // 파일명.확장자만 추출
    await download(url, folderPath, fileName);
  }
}

function pathFiltering(url, mainHostUrl, nowUrlPath) {
  if (url.includes(mainHostUrl)) {
    return url;
  } // 필요한가?
  if (url[0] === "/") {
    return mainHostUrl + url;
  } else if (url.includes("../")) {
    let path = nowUrlPath.slice(0, nowUrlPath.lastIndexOf("/")); // 파일명.확장자 없애기
    let count = url.split("../").length - 1; // ../ 몇번 들어갔는지 카운트
    for (let i = 0; i < count; i++) {
      path = path.slice(0, path.lastIndexOf("/"));
    }
    path = `${path}/${url}`;
    return path.replace(/\.\.\//g, "");
  } else {
    let path = nowUrlPath.slice(0, nowUrlPath.lastIndexOf("/") + 1);
    if (url.includes("./")) {
      path.replace("./", "");
    }
    return `${path + url}`;
  }
}

async function download(url, folderPath, fileName) {
  await axios({
    url,
    method: "GET",
    responseType: "stream",
  })
    .then((res) => {
      createFolder(folderPath);
      return res;
    })
    .then((res) => {
      createFile(res, folderPath, fileName);
      success++;
    })
    .catch((error) => {
      console.log(`${error.config.url} 존재하지 않는 url 입니다.`);
      errArray.push(error.config.url);
    });
}

async function createFile(res, folderPath, fileName) {
  // 무한 에러 처리 해야됨
  const filePath = folderPath + fileName;
  fs.readFile(filePath, (err) => {
    if (err) {
      res.data
        .pipe(fs.createWriteStream(filePath))
        .on("finish", function () {
          console.log(filePath, "파일생성 완료");
        })
        .on("error", function (err) {
          console.error(err);
          createFile(res, folderPath, fileName);
        });
    }
  });
}

async function createFolder(folderPath) {
  fs.readdir(folderPath, (err) => {
    // uploads 폴더 없으면 생성
    if (err) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
  });
}
