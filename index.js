const express = require("express"); // express module을 가져온다
const app = express(); // 모듈을 이용해 새 앱을 만든다.
const port = 5000;
const config = require("./config/key");
const bodyParser = require("body-parser");
const MongoClient = require("mongodb").MongoClient;
const cors = require("cors");
const https = require("https");
const fs = require('fs');
const { Console } = require('console');
const path = require("path");


const DATABASE_NAME = "testdb";
let database, collection;

// python 경로 설정
let pythonPathBio = '/home/ubuntu/22SH/2ndIntegration/backend/venPy8/bin/python';
let pythonPathACM = '/home/ubuntu/22SH/2ndIntegration/backend/venv/bin/python3.6';

app.use(express.json({
  limit: '200kb'
}))

// application/x-www-form-urlencoded 형식으로 된 데이터를 분석해서 가져올 수 있게 해줌
app.use(bodyParser.urlencoded({ extended: true })); //클라이언트에서 오는 정보를 서버에서 분석해서 가져올 수 있게 해줌
// applicaiton/json 형식의 데이터를 분석해서 가져올 수 있게 해줌
app.use(bodyParser.json());

app.use(cors());
app.use(express.static(path.join(__dirname, '../frontend/build')));
app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'))
})


app.listen(port, () => {
  console.log(`Moseek app listening on port ${port}`);
  // mongoDB 연결만
  MongoClient.connect(
    config.mongoURI,
    { useNewUrlParser: true },
    (error, client) => {
      if (error) {
        throw error;
      }
      database = client.db(DATABASE_NAME);
      console.log("Connected to `" + DATABASE_NAME + "`!");
    }
  );
});

const spawn = require("child_process").spawn;


app.post("/load", (req, res) => { // 편집본이 존재할때 원본 로드
  const NCTID = req.body.url; // body는 NCTID
  console.log(NCTID);
  let query = { _id: NCTID };
  let selectedAPI = req.body.api;
  let collectionNum;
  if (selectedAPI === "acm") {
    collectionNum = "ACM";
  } else {
    collectionNum = "ACM+Biolink";
  }

  const options = { useUnifiedTopology: true };

  MongoClient.connect(config.mongoURI, options, function (err, db) {

    if (err) throw err;

    const dbo = db.db("testdb");
    const collection_origin = dbo.collection(collectionNum);
    // 본문에서 해당 내용 불러옴
    collection_origin.findOne(query, function (err, result) {
      if (err) throw err;
      else {
        if (result !== null) {
          res.json(result);
        }
      }
    });
  });

});


//편집본 있으면 편집본, 없으면 원본, 원본도 없으면 실시간으로 돌려 정보추출
app.post("/api", async (req, res) => {
  const post = req.body;
  let Url = post.url; //url은 key의 이름임
  let selectedAPI = post.api;

  let NCTID;

  //NCT 번호를 뽑아내기 위한 작업
  if (Url.includes("NCT") === true) {
    //이미 URL이 NCT를 가지고 있는 경우
    let Htmltext = Url;
    let findtext = Htmltext.match("NCT[0-9]+"); //NCT를 찾아 번호를 뽑아낸다.
    NCTID = findtext[0];
  } else {
    // URL이 이미 json 형태인 경우
    if (Url.includes("json") !== true) {
      // URL이 json이 아닌 경우
      let expr = '';
      try {
        expr = Url.match("expr=[0-9a-zA-Z%+.]+")[0];
      }
      catch {
        return res.json({ "message": "It is not nctID" });
      }
      Url =
        "https://clinicaltrials.gov/api/query/full_studies?" +
        expr +
        "&fmt=json";
    }

    https.get(Url, (res) => {
      let rawHtml = "";
      res.on("data", (chunk) => {
        rawHtml += chunk;
      });
      res.on("end", () => {
        try {
          Htmltext = JSON.parse(rawHtml);
          NCTID =
            Htmltext.FullStudiesResponse.FullStudies[0].Study.ProtocolSection
              .IdentificationModule.NCTId;
        } catch (e) {
          console.error(e.message);
        }
      });
    });
  }
  // NCTID 추출하기전에 미리 117번 줄이 실행됨. 그래서 NCTID가 undefined기에 바로 resourceControl 실행되는 것.
  //MongoDB에서 가져옴
  let query = { _id: NCTID };
  let result_json;

  const options = { useUnifiedTopology: true };

  MongoClient.connect(config.mongoURI, options, function (err, db) {
    if (err) throw err;
    if (selectedAPI !== "biolinkacm") {

      // single api인 경우
      console.log("this is for single api");
      let collectionNum = "ACM+Biolink";
      if (selectedAPI === "acm") {
        collectionNum = "ACM";
      } else if (selectedAPI === "biolink") {
        collectionNum = "ACM+Biolink";
      }

      const dbo = db.db("testdb");
      const collection = dbo.collection("edit");
      const collection_origin = dbo.collection(collectionNum);

      collection.countDocuments(query, function (err, c) {
        if (err) throw err;
        if (c !== 0) {
          collection.findOne(query, function (err, result) {
            if (err) throw err;
            console.log(`edited${result}`);
            return res.json(result);
          })
        }

        // edit collection에 없으면
        else {
          // collection에 있는 내용인지 확인
          collection_origin.findOne(query, function (err, result) {
            if (err) throw err;
            else {
              if (result !== null) {
                console.log(`origin${result}`);
                return res.json(result);

              }
              else {
                let getJson;
                let result_json;
                let result2;
                console.log("enter real time code! ", selectedAPI);
                if (selectedAPI === "acm") {
                  console.log("acm!");
                  result_json = spawn(pythonPathACM, ['data_extract_ACM.py', Url]);

                  result_json.stdout.on('data', function (data) {
                    console.log(data.toString());
                    getJson = data.toString();
                    getJson = getJson.replace(/'/g, '"');
                    result_json = JSON.parse(getJson);
                    return res.json(result_json);
                  });
                  result_json.stderr.on('data', function (data) {
                    console.log(data.toString());
                  });
                  result_json.on('close', (code) => {
                    console.log(`child process exited with code ${code}`);
                  });
                } else if (selectedAPI === "biolink") {
                  console.log("biolink!");
                  result_json = spawn(pythonPathBio, ['data_extract_Combine.py', Url, 1]);

                  result_json.stdout.on('data', function (data) {
                    console.log(data.toString());
                    getJson = data.toString();
                    getJson = getJson.replace(/'/g, '"');
                    result_json = JSON.parse(getJson);
                    return res.json(result_json);
                  });
                  result_json.stderr.on('data', function (data) {
                    console.log(data.toString());
                  });
                  result_json.on('close', (code) => {
                    console.log(`child process exited with code ${code}`);
                  });
                } else {
                  console.log("combine!");
                  result_json = spawn(pythonPathBio, ['data_extract_Combine.py', Url, 1]);
                  result_json.stdout.on('data', function (data) {
                    console.log(data.toString());
                    getJson = data.toString();
                    result2 = spawn(pythonPathACM, ['data_extract_ACM.py', Url]);

                    let json2;
                    result2.stdout.on('data', function (data2) {
                      console.log(data2.toString());
                      json2 = data2.toString();

                      let willSend = "{\'biolink\': ";
                      willSend += getJson;
                      willSend += ", \'acm\': " + json2 + "}";

                      willSend = willSend.replace(/'/g, '"');
                      result_json = JSON.parse(willSend);
                      return res.json(willSend);
                    });
                    getJson = getJson.replace(/'/g, '"');
                    result_json = JSON.parse(getJson);
                    return res.json(result_json);
                  });
                  result_json.stderr.on('data', function (data) {
                    console.log(data.toString());
                  });
                  result_json.on('close', (code) => {
                    console.log(`child process exited with code ${code}`);
                  });

                } // end logic by selectedAPI
              }// end if no json in mongoDB
            }
          })
        } // end if edit collection isn't
      });
    } // for single api
    else {
      // this is only for double api : only real time right now
      console.log("combine!");
      result_json = spawn(pythonPathBio, ['data_extract_Combine.py', Url, 1]);
      result_json.stdout.on('data', function (data) {
        getJson = data.toString();
        result2 = spawn(pythonPathACM, ['data_extract_ACM.py', Url]);

        let json2;
        result2.stdout.on('data', function (data2) {
          json2 = data2.toString();

          let willSend = "{ 'biolink': ";
          willSend += getJson;
          willSend += ", 'acm': " + json2 + "}";


          willSend = willSend.replace(/'/g, '"');
          result_json = JSON.parse(willSend);
          return res.json(result_json);
        });
      });
      result_json.stderr.on('data', function (data) {
        console.log(data.toString());
      });
      result_json.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
      });
    }
  });
  // }
});

app.post("/create", (req, res) => { // req.body는 JSON 값, 편집 저장용 라우터
  console.log(req.body);
  const data = JSON.stringify(req.body);

  fs.writeFileSync(`./NCT_ID_database/${req.body._id}.json`, data, 'utf8', function (error) {
    console.log('writeFile completed');
  });


  const options = { useUnifiedTopology: true };

  MongoClient.connect(config.mongoURI, options, function (err, db) {

    if (err) throw err;

    const dbo = db.db("testdb");
    const collection = dbo.collection("edit");
    const query = { _id: req.body._id };
    var total = 0;

    let data = fs.readFileSync(`./NCT_ID_database/${req.body._id}.json`, 'utf-8');
    let json = JSON.parse(data);

    collection.countDocuments(query, function (err, c) {
      console.log('Count is ' + c);
      if (c == 1) {
        collection.deleteOne(query, function (err, obj) {
          if (err) throw err;
          console.log("delete the same file")
        })
      }
    });

    // 이게 먼저 실행됨 (await 써야할 듯)
    collection.insertOne(json, function (err, res) {
      if (err) throw err;
      console.log("1 document inserted");
      db.close();
    });

  });
  res.send(req.body);
});

// img history
app.post("/img", async (req, res) => {
  console.log("img post");
  const { imgSrc, nctID } = req.body;

  const data1 = fs.readFileSync(`./searchHistory/img-url.txt`, 'utf8');
  const data2 = fs.readFileSync(`./searchHistory/img-nct.txt`, 'utf8');
  let images = data1.split('\n');
  let ncts = data2.split('\n');
  let idx;
  let flag = 0;

  ncts = ncts.filter((nct, index) => {
    if (nct === nctID) {
      idx = index;
      flag = 1;
    }
    return nct !== nctID
  });



  if (flag) { // 중복이 일어났다면 중복된거 제거
    images.splice(idx, 1);
  }
  else { // 중복이 일어나지 않았다면 맨 앞의 것 제거
    ncts = ncts.slice(1, 3);
    images = images.slice(1, 3);
  }

  ncts.push(nctID);
  images.push(imgSrc);

  const nctAryToStr = ncts.join('\n');
  const imageAryToStr = images.join('\n');

  fs.writeFileSync(`./searchHistory/img-url.txt`, `${imageAryToStr}`, 'utf8', function (error) {
    console.log('writeFile completed');
  });
  fs.writeFileSync(`./searchHistory/img-nct.txt`, `${nctAryToStr}`, 'utf8', function (error) {
    console.log('writeFile completed');
  });

  return res.json({ "message": "Good" });
});

// img history
app.get("/img", async (req, res) => {
  const data1 = fs.readFileSync(`./searchHistory/img-url.txt`, 'utf8');
  const data2 = fs.readFileSync(`./searchHistory/img-nct.txt`, 'utf8');
  let images = data1.split('\n');
  let ncts = data2.split('\n');

  images = images.reverse();
  ncts = ncts.reverse();
  const result = {
    images,
    ncts,
  };
  res.send(result);
});




// crawlling
app.post("/crawling", async (req, res) => {
  const post = req.body;
  let NCTID = post.url;
  let getResult;
  const result = spawn(pythonPathACM, ['crawling.py', NCTID]);
  result.stdout.on('data', function (data) {
    getResult = data.toString();
    res.send(getResult);
  });
  result.stderr.on('data', function (data) {
    console.log(data.toString());
  });

  result.on("close", (code) => {
    console.log(`crawling _ child process exited with code ${code}`);
  });

});
