const fastq = require('fastq')

const worker = async (id) => {
    await new Promise((res, rej) => setTimeout(() => {
        console.log('worker', id)
        res('ok')
    }, 10000))
}

const q = fastq.promise(worker, 1)

q.push(1); console.log('push', 1)
q.push(2); console.log('push', 2)
q.push(3); console.log('push', 3)
q.push(4); console.log('push', 4)
q.push(5); console.log('push', 5)