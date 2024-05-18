const proxy = (param, obj) =>
  new Proxy(obj, {
    get: function (target, prop) {
      return `${param} ${target[prop]}`
    },
  })

// "-d","medium", // -d specifies the detail
const details = proxy('-d', {
  preview: 'preview',
  reduced: 'reduced',
  medium: 'medium',
  full: 'full',
  raw: 'raw',
})

// "-o","unordered", // -o specifies the sample ordering
const orders = proxy('-o', {
  unordered: 'unordered',
  sequential: 'sequential',
})

// "-f","normal" // -f specifies the feature sensitivity
const features = proxy('-f', {
  normal: 'normal',
  high: 'high',
})

const { exec } = require('child_process')
const dir = __dirname
const libDir = `${dir}/src/lib`
const tmpDir = `${dir}/tmp`
const imgDir = '/Users/salvatorelaspata/3DObject/francesco/'

const c = (...args) => {
  const [first, ...rest] = args
  if (rest.length === 0) {
    return Object.values(first)
  } else {
    return Object.values(first).reduce((acc, element) => {
      return acc.concat(
        c(...rest).map(combination => `${element} ${combination}`)
      )
    }, [])
  }
}

const combinazioni = {
  details,
  orders,
  features,
}

console.log(c(combinazioni.details, combinazioni.orders, combinazioni.features))

// create all combination of detail, order, feature
const createCombination = function* (_details, _orders, _features) {
  for (const key in _details) {
    if (Object.hasOwnProperty.call(_details, key)) {
      const detail = _details[key]
      for (const key in _orders) {
        if (Object.hasOwnProperty.call(_orders, key)) {
          const order = _orders[key]
          for (const key in _features) {
            if (Object.hasOwnProperty.call(_features, key)) {
              const feature = _features[key]
              yield new Promise((res, rej) =>
                exec(
                  `cd ${libDir} && ./HelloPhotogrammetry ${imgDir}/ ${tmpDir}/test/models/test2${`_${
                    detail.split(' ')[1]
                  }_`}${`_${order.split(' ')[1]}_`}${`_${
                    feature.split(' ')[1]
                  }`}.usdz ${detail} ${order} ${feature}`,
                  error => {
                    if (error) {
                      console.error(`exec error: ${error}`)
                      rej(error)
                      return
                    }
                    res('ok')
                  }
                )
              )
            }
          }
        }
      }
    }
  }
}

;(async function () {
  const unorderedOnly = (({ unordered }) => ({ unordered }))(orders)
  for await (const log of createCombination(details, unorderedOnly, features)) {
    console.log(log)
  }
})()
