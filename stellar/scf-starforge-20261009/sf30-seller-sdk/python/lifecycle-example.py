"""MIT. A startup-owned async service reused by the original Python merchant."""
import asyncio
import statistics

queue = None
processor = None


async def startup():
    """Initialize one async resource per worker before it accepts any request."""
    global queue, processor
    queue = asyncio.Queue(maxsize=1)
    processor = asyncio.create_task(process())


async def process():
    # Replace this local worker with your own initialized async client or pool.
    # The queue and every reply Future belong to one persistent event loop.
    while True:
        item = await queue.get()
        if item is None:
            return
        values, reply = item
        if not reply.cancelled():
            reply.set_result({
                'count': len(values), 'mean': statistics.fmean(values),
                'minimum': min(values), 'maximum': max(values),
            })


async def summarize(input):
    reply = asyncio.get_running_loop().create_future()
    await queue.put((input['values'], reply))
    return await reply


async def shutdown():
    """Release initialized resources once after the original seller drains."""
    if processor is not None:
        await queue.put(None)
        await processor
