const express = require("express");
const serverless = require('serverless-http');
const cors = require("cors");
const moment = require("moment");
const { ObjectId } = require("mongodb");
const router = express.Router();
const _ = require('lodash');

const { MongoClient } = require("mongodb");

const connectionString = "mongodb+srv://vsingamchetty:user1234@cluster0.ch8kwyt.mongodb.net/";
const dbName = "nisumscorecard_testing";

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Create a reusable MongoClient instance for connection pooling
const client = new MongoClient(connectionString,{
  useNewUrlParser: true,
  useUnifiedTopology: true,
  connectTimeoutMS: 30000, // Connection timeout in milliseconds
});
 client.connect()
  .then(() => {
    console.log("Connected to MongoDB");

  })
  .catch((err) => {
    console.error("Error connecting to MongoDB:", err);
  });

let db=client.db(dbName);


//to get all the employees data
router.get("/employees", async(req, res) => {
  await db.collection("employees")
    .find()
    .toArray()
    .then((result) => {
      res.send(result);
    })
    .catch((error) => res.status(401).send(error));
});

//to get only individual employee data
router.get("/employee/:id", async(req, res) => {
  let Id = parseInt(req.params.id);
  await db.collection("employees")
    .findOne({ empId: Id }, { projection: { _id: false } })
    .then((result) => {
      if (!result)
        res.status(404).json({ message: "Employee not found" });
      else
        res.send(result);
    })
    .catch((error) => res.status(401).send(error));
});

//login Check
router.post('/login', async (req, res) => {
  const { empId } = req.body;
  try {
    const user = await db.collection('employees').findOne({ empId: empId }, { projection: { _id: false } })
    if (!user) {
      return res.status(401).json({ error: 'Authentication failed', message: 'User not found' });
    }
    if (empId === user.empId) {
      res.json({ message: 'Login successful', user });
    } else {
      res.status(401).json({ error: 'Authentication failed', message: 'Email and password do not match' });
    }
  }
  catch (error) {
    res.status(401).json({ error: 'Internal server error', details: error.message });
  }
});


//to get activities to display
router.get("/activities", async(req, res) => {
  await db.collection("activities_master")
    .find()
    .toArray()
    .then((result) => {
      res.send(result);
    })
    .catch((error) => res.status(401).send(error));
});

/*
Example of post Data
{
    "reportees":[41689,41716,41710,41750,41751,41714],
    "sort":{"type":"empId","order":-1}
    ,"page":1,"perPage":10,
    "searchText":"eng"
}*/
router.post("/getreportees",async (req, res) => {
  let reporteesArray = req.body.reportees || [];
  let sortBy = req.body.sort ? req.body.sort.type || "_id" : "_id";
  let sortByOrder = req.body.sort ? parseInt(req.body.sort.order) || 1 : 1;
  let page = req.body.page ? parseInt(req.body.page) || 1 : 1;
  let limit = req.body.perPage ? parseInt(req.body.perPage) || 10 : 10;
  let skip = (page - 1) * limit || 0;
  let query = { empId: { $in: reporteesArray } };
  let aggre = [{ $match: { empId: { $in: reporteesArray } } }];

  if (req.body.searchText) {
    let searchText = req.body.searchText.trim();
    let searchStr = new RegExp(searchText, "ig");
    let orCondation = {
      $or: [
        { empId: searchStr },
        { empName: searchStr },
        { designation: searchStr },
      ],
    };
    aggre.push({ $match: orCondation });

    query = Object.assign(query);
  }
  aggre.push({ $sort: { [sortBy]: sortByOrder } });
  let facet = {
    data: [{ $skip: skip }, { $limit: limit }],
    totalCount: [{ $count: "count" }],
  };
  aggre.push({ $facet: facet });
  aggre.push({ $unwind: { path: "$totalCount" } });
  await db.collection("employees")
    .aggregate(aggre)
    .toArray()
    .then((result) => {
      if (result && result.length) {
        res.status(201).json({ ...result[0] });
      } else {
        res.status(404).json({ data: [], totalCount: { count: 0 } });
      }
    })
    .catch((error) => res.status(401).send(error));
});


//Example of post Data
/*
{
    "empId":10000,
    "data":{
        "aName":"Approval of timesheet",
        "aId":"D001",
        "type":"default",
        "score":3,
        "comments":""
    }
}
*/
router.post('/createActivity',async (req, res) => {
  const empId = req.body.empId;
  if (!empId) {
    res.status(401).json({ "message": "Employee id is missing" });
    return
  } else {
    let { data } = req.body;

    //data validation
    if (!_.get(data, "aName", "") || !_.get(data, "aId", "") || !_.get(data, "type", "") || !_.get(data, "score", "")) {
      res.status(401).json({ "error": "Invalid Activity data" });
      return;
    }

    if (data.score === (0 || -0) || data.score > 5 || data.score < -5) {
      res.status(401).json({ "message": "Score Should be between 1 to 5 or -1 to -5 only" });
      return
    }
    if(data["comments"]===undefined){
      res.status(401).json({ "message": "need comments field" });
      return
    }

    data = { ...data, "recorded_date": new Date() };
    data = Object.assign(data, { "_id": new ObjectId() })

    let query = { empId: empId };
    await db.collection('performance_master').findOne(query).then(async(result) => {
      if (result) {
       await db.collection('performance_master').updateOne(query, { $push: { "activities": data } })
          .then(async (updateRes) => {
            await calculateAverage(query);
            res.status(201).json({ "reuslt": updateRes });

          })
          .catch((error) => {
            res.json({ "error": error });
          });
      } else {
        let insertData = { empId: empId, activities: [] };

        insertData.activities.push(data);
       await db.collection('performance_master').insertOne(insertData).then(async (result) => {
          await calculateAverage(query);
          res.status(201).json({ "result": result });

        }).catch((error) => {
          res.json({ "message": error })

        })
      }
    }).catch((error) => {
      console.log(error)
      res.send(query)
    })


  }
})

//calculating average score and updating into employees data
const calculateAverage = async(query) => {
  return await new Promise(async(res, rej) => {
    await db.collection("performance_master")
      .findOne(query)
      .then(async(result) => {
        let activitiesList = result.activities;
        let activitiesLength = activitiesList.length;
        let score = activitiesList.reduce((acc, curr) => { return acc + curr.score }, 0);
        let averageScore = 0;
        score < 0
          ? (averageScore = 0)
          : (averageScore = score / activitiesLength);

        if (averageScore % 1 !== 0) {
          averageScore = averageScore.toFixed(1);
        }

        await db.collection("employees")
          .updateOne(query, { $set: { score: Number(averageScore) } })
          .then((result) => {
            res(result);
          })
          .catch((error) => rej(error));
      })
      .catch((error) => {
        rej(error);
      });
  });
};

//sending filtered activities data
/*Example post data
{
    "empId":41689,
    "fromDate":"2024-03-10",
    "toDate":"2024-03-14"
}
*/
router.post("/getActivities", async(req, res) => {
  let { empId, fromDate, toDate, today } = req.body;
  if (!empId || typeof empId == "string") {
    res.status(401).json({ message: "Employee id is missing / EmpId should be string only" });
    return;
  } else {
    let query = {
      empId: empId,
    };
    if (fromDate && toDate) {
      fromDate = new Date(fromDate)
      toDate = new Date(toDate);
      toDate.setHours(23);
      toDate.setMinutes(59);
      toDate.setSeconds(59);
      query["activities.recorded_date"] = {
        $gte: new Date(fromDate),
        $lte: new Date(toDate),
      };
    } else {
      // If fromDate and toDate are not provided, fetch data for the last 90 days
      query["activities.recorded_date"] = {
        $gte: moment().subtract(90, "days").toDate(),
        $lte: moment().toDate(),
      };
    }
    await db.collection("performance_master")
      .findOne(query)
      .then((results) => {
        res.status(201).json(results);
      })
      .catch((error) => {
        res.status(401).json({ message: "Error fetching data" }, error);
      });
  }
});




app.use('/.netlify/functions/api', router);
// app.listen(5000,()=>{console.log("running")})
module.exports.handler=serverless(app)
